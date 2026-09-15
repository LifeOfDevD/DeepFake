import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { NotificationService } from '../../src/services/notification-service.js';

describe('Unit: Transactional Notification Outbox & In-App Service', () => {
  let db: any;
  let service: NotificationService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    service = new NotificationService();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('queues notifications in transactional outbox with pending status', () => {
    const outboxItem = service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'dr.verma@apexhealth.example',
      title: 'Takedown simulated',
      body: 'Your incident submission has been simulated.',
      notification_type: 'submission_approval_required',
      delivery_channel: 'in_app',
      idempotency_key: 'test_notif_001'
    });

    expect(outboxItem.id).toBeDefined();
    expect(outboxItem.status).toBe('pending');
    expect(outboxItem.delivery_channel).toBe('in_app');
  });

  it('prevents duplicate queuing using idempotency_key', () => {
    const item1 = service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'dr.verma@apexhealth.example',
      title: 'Duplicate test',
      body: 'Test body',
      notification_type: 'case_assigned',
      idempotency_key: 'dedup_001'
    });

    const item2 = service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'dr.verma@apexhealth.example',
      title: 'Duplicate test',
      body: 'Test body',
      notification_type: 'case_assigned',
      idempotency_key: 'dedup_001'
    });

    expect(item2.id).toBe(item1.id);
    const count = (db.prepare('SELECT COUNT(*) as c FROM notification_outbox WHERE idempotency_key = ?').get('dedup_001') as any).c;
    expect(count).toBe(1);
  });

  it('processes pending outbox items and records in-app notifications', async () => {
    service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'usr_apex_mgr_02',
      title: 'Clock Warning',
      body: 'IT Rules 2021 clock deadline approaching.',
      notification_type: 'clock_due_soon',
      delivery_channel: 'in_app'
    });

    const processedCount = await service.processPendingOutbox(10);
    expect(processedCount).toBeGreaterThanOrEqual(1);

    // Verify in_app_notifications table has received the delivered message
    const inApp = service.getUserNotifications('org_apex_health_01', 'usr_apex_mgr_02');
    expect(inApp.length).toBeGreaterThanOrEqual(1);
    expect(inApp[0].title).toBe('Clock Warning');
    expect(inApp[0].is_read).toBe(0);
  });

  it('marks individual and all notifications as read', async () => {
    service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'usr_apex_mgr_02',
      title: 'Note 1',
      body: 'Body 1',
      notification_type: 'clock_overdue',
      delivery_channel: 'in_app'
    });
    service.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'usr_apex_mgr_02',
      title: 'Note 2',
      body: 'Body 2',
      notification_type: 'clock_overdue',
      delivery_channel: 'in_app'
    });
    await service.processPendingOutbox(10);

    const notes = service.getUserNotifications('org_apex_health_01', 'usr_apex_mgr_02');
    expect(notes.length).toBe(2);

    // Mark single as read
    service.markAsRead('org_apex_health_01', 'usr_apex_mgr_02', notes[0].id);
    const updatedNotes = service.getUserNotifications('org_apex_health_01', 'usr_apex_mgr_02');
    const note1 = updatedNotes.find((n) => n.id === notes[0].id);
    expect(note1!.is_read).toBe(1);

    // Mark all as read
    service.markAllAsRead('org_apex_health_01', 'usr_apex_mgr_02');
    const finalNotes = service.getUserNotifications('org_apex_health_01', 'usr_apex_mgr_02');
    for (const n of finalNotes) {
      expect(n.is_read).toBe(1);
    }
  });
});
