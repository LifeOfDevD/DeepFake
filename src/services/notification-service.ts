import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/env.js';
import {
  InAppNotificationRecord,
  NotificationOutboxRecord,
  NotificationType,
  Role
} from '../domain/types.js';

export interface QueueNotificationInput {
  organization_id: string;
  recipient_user_id?: string | null;
  user_id?: string | null;
  recipient_role?: Role | null;
  recipient_email?: string;
  recipient?: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, any> | null;
  idempotency_key?: string;
  delivery_channel?: 'in_app' | 'console' | 'file' | 'dry_run';
}

export interface NotificationAdapter {
  deliver(item: NotificationOutboxRecord): Promise<void>;
}

export class InAppNotificationAdapter implements NotificationAdapter {
  constructor(private db: Database.Database) {}

  public async deliver(item: NotificationOutboxRecord): Promise<void> {
    const now = new Date().toISOString();

    // If user_id is given, deliver directly
    let targetUserIds: string[] = [];
    if (item.recipient_user_id) {
      targetUserIds = [item.recipient_user_id];
    } else if (item.recipient_role) {
      const rows = this.db
        .prepare('SELECT user_id FROM memberships WHERE organization_id = ? AND role = ?')
        .all(item.organization_id, item.recipient_role) as { user_id: string }[];
      targetUserIds = rows.map((r) => r.user_id);
    } else {
      // Find user by email
      const user = this.db.prepare('SELECT id FROM users WHERE email = ?').get(item.recipient_email) as
        | { id: string }
        | undefined;
      if (user) targetUserIds = [user.id];
    }

    if (targetUserIds.length === 0) {
      // Still deliver to first member or owner as fallback
      const owner = this.db
        .prepare("SELECT user_id FROM memberships WHERE organization_id = ? AND role = 'org_owner'")
        .get(item.organization_id) as { user_id: string } | undefined;
      if (owner) targetUserIds = [owner.user_id];
    }

    const stmt = this.db.prepare(`
      INSERT INTO in_app_notifications (
        id, organization_id, user_id, notification_outbox_id,
        title, body, notification_type, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    for (const uId of targetUserIds) {
      stmt.run(
        `notif_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        item.organization_id,
        uId,
        item.id,
        item.title,
        item.body,
        item.notification_type,
        now
      );
    }
  }
}

export class ConsoleNotificationAdapter implements NotificationAdapter {
  public async deliver(item: NotificationOutboxRecord): Promise<void> {
    // Zero external calls: only logs locally
    console.log(`[DRY-RUN NOTIFICATION] To: ${item.recipient_email} | Type: ${item.notification_type} | Title: ${item.title}`);
  }
}

export class FilePreviewNotificationAdapter implements NotificationAdapter {
  constructor(private storageDir: string = './storage/notifications') {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public async deliver(item: NotificationOutboxRecord): Promise<void> {
    const filename = path.join(this.storageDir, `preview-${item.id}.json`);
    fs.writeFileSync(filename, JSON.stringify(item, null, 2), 'utf8');
  }
}

export class NotificationService {
  private inAppAdapter: InAppNotificationAdapter;
  private consoleAdapter: ConsoleNotificationAdapter;
  private fileAdapter: FilePreviewNotificationAdapter;

  constructor(private db: Database.Database = getDatabase()) {
    this.inAppAdapter = new InAppNotificationAdapter(this.db);
    this.consoleAdapter = new ConsoleNotificationAdapter();
    this.fileAdapter = new FilePreviewNotificationAdapter();
  }

  /**
   * Transactionally queues a notification intent in the outbox
   */
  public queueNotification(input: QueueNotificationInput): NotificationOutboxRecord {
    const idempotencyKey = input.idempotency_key || `notif_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const existing = input.idempotency_key
      ? (this.db
          .prepare('SELECT * FROM notification_outbox WHERE idempotency_key = ?')
          .get(input.idempotency_key) as NotificationOutboxRecord | undefined)
      : undefined;

    if (existing) {
      return existing; // Idempotent duplicate prevention
    }

    const id = `out_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const channel = input.delivery_channel || getConfig().modes.notificationMode || 'in_app';
    const recipientUserId =
      input.recipient_user_id ||
      input.user_id ||
      (input.recipient && input.recipient.startsWith('usr_') ? input.recipient : null);
    const recipientEmail =
      input.recipient_email ||
      (input.recipient && input.recipient.includes('@') ? input.recipient : 'desk-user@example.com');

    const stmt = this.db.prepare(`
      INSERT INTO notification_outbox (
        id, organization_id, recipient_user_id, recipient_role, recipient_email,
        notification_type, title, body, payload, status, attempts, max_attempts,
        idempotency_key, delivery_channel, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.organization_id,
      recipientUserId,
      input.recipient_role || null,
      recipientEmail,
      input.notification_type,
      input.title,
      input.body,
      input.payload ? JSON.stringify(input.payload) : null,
      idempotencyKey,
      channel,
      now,
      now
    );

    return this.getOutboxItemById(id)!;
  }

  public getOutboxItemById(id: string): NotificationOutboxRecord | null {
    const row = this.db.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(id) as
      | NotificationOutboxRecord
      | undefined;
    return row || null;
  }

  /**
   * Processes a batch of pending outbox notifications with retries
   */
  public async processOutboxBatch(batchSize = 25): Promise<{ processed: number; succeeded: number; failed: number }> {
    const pendingItems = this.db
      .prepare(`
        SELECT * FROM notification_outbox
        WHERE status = 'pending' AND attempts < max_attempts
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(batchSize) as NotificationOutboxRecord[];

    let succeeded = 0;
    let failed = 0;

    for (const item of pendingItems) {
      try {
        await this.deliverItem(item);
        const now = new Date().toISOString();
        this.db
          .prepare("UPDATE notification_outbox SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?")
          .run(now, now, item.id);
        succeeded++;
      } catch (err: any) {
        failed++;
        const nextAttempts = item.attempts + 1;
        const newStatus = nextAttempts >= item.max_attempts ? 'failed' : 'pending';
        const now = new Date().toISOString();

        this.db
          .prepare(`
            UPDATE notification_outbox
            SET attempts = ?, status = ?, last_error = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(nextAttempts, newStatus, String(err.message || err).slice(0, 500), now, item.id);
      }
    }

    return { processed: pendingItems.length, succeeded, failed };
  }

  /**
   * Alias for processing pending outbox notifications, returns processed count
   */
  public async processPendingOutbox(batchSize = 25): Promise<number> {
    const result = await this.processOutboxBatch(batchSize);
    return result.processed;
  }

  private async deliverItem(item: NotificationOutboxRecord): Promise<void> {
    // Deliver via in-app by default, plus console/file if configured
    await this.inAppAdapter.deliver(item);

    if (item.delivery_channel === 'console' || getConfig().modes.notificationMode === 'console') {
      await this.consoleAdapter.deliver(item);
    } else if (item.delivery_channel === 'file' || getConfig().modes.notificationMode === 'file') {
      await this.fileAdapter.deliver(item);
    }
  }

  /**
   * Retrieves in-app notifications for a user
   */
  public getInAppNotifications(
    userId: string,
    organizationId: string,
    unreadOnly = false
  ): InAppNotificationRecord[] {
    let query = 'SELECT * FROM in_app_notifications WHERE user_id = ? AND organization_id = ?';
    if (unreadOnly) {
      query += ' AND is_read = 0';
    }
    query += ' ORDER BY created_at DESC LIMIT 50';

    return this.db.prepare(query).all(userId, organizationId) as InAppNotificationRecord[];
  }

  public getUnreadCount(userId: string, organizationId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND organization_id = ? AND is_read = 0')
      .get(userId, organizationId) as { count: number };
    return row.count;
  }

  public markNotificationRead(notificationId: string, userId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE in_app_notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ?')
      .run(now, notificationId, userId);
  }

  public markAllRead(userId: string, organizationId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE in_app_notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND organization_id = ? AND is_read = 0')
      .run(now, userId, organizationId);
  }

  public getUserNotifications(
    organizationId: string,
    userId: string,
    unreadOnly = false,
    limit = 50
  ): InAppNotificationRecord[] {
    let query = 'SELECT * FROM in_app_notifications WHERE user_id = ? AND organization_id = ?';
    if (unreadOnly) {
      query += ' AND is_read = 0';
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    return this.db.prepare(query).all(userId, organizationId, limit) as InAppNotificationRecord[];
  }

  public markAsRead(organizationId: string, userId: string, notificationId: string): InAppNotificationRecord | null {
    this.markNotificationRead(notificationId, userId);
    return (
      (this.db
        .prepare('SELECT * FROM in_app_notifications WHERE id = ? AND organization_id = ?')
        .get(notificationId, organizationId) as InAppNotificationRecord) || null
    );
  }

  public markAllAsRead(organizationId: string, userId: string): number {
    const unread = this.getUnreadCount(userId, organizationId);
    this.markAllRead(userId, organizationId);
    return unread;
  }
}
