import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { EvidenceStorage, LocalEvidenceStorage } from '../storage/evidence-storage.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';
import { EvidenceItem } from '../domain/types.js';
import { validateEvidenceStateTransition } from '../domain/evidence-state-machine.js';
import { v4 as uuidv4 } from 'uuid';

export interface RetentionPurgeOptions {
  dryRun?: boolean;
  organizationId?: string;
  actor?: ActorContext;
}

export interface RetentionPurgeResult {
  evaluated: number;
  purged: number;
  skippedOnHold: number;
  purgedEvidenceIds: string[];
}

export class RetentionService {
  private auditService: AuditService;

  constructor(
    private db: Database.Database = getDatabase(),
    private storage: EvidenceStorage = new LocalEvidenceStorage()
  ) {
    this.auditService = new AuditService(this.db);
  }

  public setStorage(storage: EvidenceStorage): void {
    this.storage = storage;
  }

  /**
   * Identifies and purges evidence items whose retention period has elapsed,
   * strictly honoring legal holds and retaining metadata tombstones for chain of custody.
   */
  public async purgeExpiredEvidence(options: RetentionPurgeOptions = {}): Promise<RetentionPurgeResult> {
    const now = new Date().toISOString();
    const dryRun = options.dryRun ?? false;

    let query = `
      SELECT * FROM evidence_items
      WHERE retention_until < ?
        AND status IN ('available', 'quarantined')
    `;
    const params: any[] = [now];

    if (options.organizationId) {
      query += ' AND organization_id = ?';
      params.push(options.organizationId);
    }

    query += ' ORDER BY retention_until ASC';

    const candidates = this.db.prepare(query).all(...params) as EvidenceItem[];

    let evaluated = 0;
    let purged = 0;
    let skippedOnHold = 0;
    const purgedEvidenceIds: string[] = [];

    const actor = options.actor || {
      user_id: 'system_retention_worker',
      email: 'retention@system.internal',
      role: 'system_admin' as any,
      ip_address: '127.0.0.1'
    };

    for (const item of candidates) {
      evaluated++;

      // Check for active legal holds
      if (item.legal_hold === 1) {
        skippedOnHold++;
        continue;
      }

      const activeHold = this.db
        .prepare('SELECT id FROM evidence_retention_holds WHERE evidence_id = ? AND released_at IS NULL LIMIT 1')
        .get(item.id);

      if (activeHold) {
        skippedOnHold++;
        continue;
      }

      // Invariant state transition check
      validateEvidenceStateTransition(item.status, 'retention_expired');

      if (dryRun) {
        purged++;
        purgedEvidenceIds.push(item.id);
        continue;
      }

      // 1. Delete physical payload from storage provider
      try {
        await this.storage.delete(item.storage_key);
      } catch (err) {
        // Continue if storage object was already absent
      }

      // 2. Mark item as retention_expired, retaining immutable metadata and hash
      this.db
        .prepare(`
          UPDATE evidence_items
          SET status = 'retention_expired',
              deleted_at = ?,
              deletion_reason = 'Automated retention policy expiration',
              updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(now, now, item.id, item.organization_id);

      // 3. Record access event
      const eventId = `eacc_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      this.db
        .prepare(`
          INSERT INTO evidence_access_events (
            id, organization_id, evidence_id, actor_user_id,
            action, success, ip_address, user_agent, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          eventId,
          item.organization_id,
          item.id,
          actor.user_id,
          'evidence_retention_purged',
          1,
          actor.ip_address || '127.0.0.1',
          'System-Retention-Worker/1.0',
          now,
          JSON.stringify({ retention_until: item.retention_until, sha256: item.sha256 })
        );

      // 4. Audit ledger entry
      this.auditService.record({
        organization_id: item.organization_id,
        actor_user_id: actor.user_id,
        actor_email: actor.email,
        action: 'evidence.retention_purged',
        resource_type: 'evidence',
        resource_id: item.id,
        details: {
          safe_display_name: item.safe_display_name,
          sha256: item.sha256,
          retention_until: item.retention_until
        },
        ip_address: actor.ip_address
      });

      purged++;
      purgedEvidenceIds.push(item.id);
    }

    return {
      evaluated,
      purged,
      skippedOnHold,
      purgedEvidenceIds
    };
  }

  /**
   * Starts a background recurring retention worker.
   */
  public startRetentionWorker(intervalMs: number = 3600000): NodeJS.Timeout {
    const timer = setInterval(async () => {
      try {
        await this.purgeExpiredEvidence();
      } catch (err: any) {
        console.error('[RetentionWorker] Scheduled purge failed:', err.message);
      }
    }, intervalMs);

    if (timer.unref) {
      timer.unref();
    }
    return timer;
  }

  /**
   * Stops a running retention worker.
   */
  public stopRetentionWorker(timer: NodeJS.Timeout): void {
    clearInterval(timer);
  }

  /**
   * Runs a single idempotent retention sweep (suitable for cron/CLI/worker startup).
   */
  public async runRetentionJobOnce(options: RetentionPurgeOptions = {}): Promise<RetentionPurgeResult> {
    return this.purgeExpiredEvidence(options);
  }
}
