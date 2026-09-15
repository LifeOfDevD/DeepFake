import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/env.js';
import { rootLogger, Logger } from '../utils/logger.js';
import { RetentionService } from '../services/retention-service.js';
import { NotificationService } from '../services/notification-service.js';
import { BackupService } from '../services/backup-service.js';
import { SubjectService } from '../services/monitoring/subject-service.js';
import { MonitoringPolicyService } from '../services/monitoring/monitoring-policy-service.js';
import { SignalIngestionService } from '../services/monitoring/signal-ingestion-service.js';
import { CandidateCorrelationService } from '../services/monitoring/correlation-service.js';
import { LocalFixtureAdapter } from '../services/monitoring/adapters/local-fixture-adapter.js';
import { ProviderSyncService } from '../services/integrations/provider-sync-service.js';

export interface WorkerStatus {
  worker_name: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  last_heartbeat_at: string;
  last_run_duration_ms: number | null;
  iteration_count: number;
  error_count: number;
  last_error: string | null;
  metadata: string | null;
}

export class WorkerManager {
  private isRunning = false;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private logger: Logger;
  private retentionService: RetentionService;
  private notificationService: NotificationService;
  private backupService: BackupService;
  private subjectService: SubjectService;
  private policyService: MonitoringPolicyService;
  private signalService: SignalIngestionService;
  private correlationService: CandidateCorrelationService;
  private localFixtureAdapter: LocalFixtureAdapter;
  private providerSyncService: ProviderSyncService;

  constructor(private db: Database.Database = getDatabase()) {
    this.logger = rootLogger.child({ component: 'WorkerManager' });
    this.retentionService = new RetentionService(this.db);
    this.notificationService = new NotificationService(this.db);
    this.backupService = new BackupService(this.db);
    this.subjectService = new SubjectService(this.db);
    this.policyService = new MonitoringPolicyService(this.db);
    this.signalService = new SignalIngestionService(this.db);
    this.correlationService = new CandidateCorrelationService(this.db);
    this.localFixtureAdapter = new LocalFixtureAdapter();
    this.providerSyncService = new ProviderSyncService(this.db);
  }

  private updateHeartbeat(
    workerName: string,
    status: 'running' | 'idle' | 'stopped' | 'error',
    durationMs: number | null = null,
    metadata: Record<string, any> | null = null,
    error: string | null = null
  ) {
    const nowIso = new Date().toISOString();
    try {
      const existing = this.db
        .prepare('SELECT iteration_count, error_count FROM worker_heartbeats WHERE worker_name = ?')
        .get(workerName) as { iteration_count: number; error_count: number } | undefined;

      const iterationCount = (existing?.iteration_count || 0) + (status === 'idle' ? 1 : 0);
      const errorCount = (existing?.error_count || 0) + (status === 'error' ? 1 : 0);

      this.db
        .prepare(`
          INSERT INTO worker_heartbeats (
            worker_name, status, last_heartbeat_at, last_run_duration_ms, 
            iteration_count, error_count, last_error, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(worker_name) DO UPDATE SET
            status = excluded.status,
            last_heartbeat_at = excluded.last_heartbeat_at,
            last_run_duration_ms = COALESCE(excluded.last_run_duration_ms, worker_heartbeats.last_run_duration_ms),
            iteration_count = excluded.iteration_count,
            error_count = excluded.error_count,
            last_error = excluded.last_error,
            metadata = excluded.metadata
        `)
        .run(
          workerName,
          status,
          nowIso,
          durationMs,
          iterationCount,
          errorCount,
          error,
          metadata ? JSON.stringify(metadata) : null
        );
    } catch (err: any) {
      this.logger.error(`Failed to update heartbeat for ${workerName}`, err);
    }
  }

  /**
   * 1. Retention Policy Enforcement Worker
   */
  public async runRetentionWorker(): Promise<Record<string, any>> {
    const workerName = 'retention_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const result = await this.retentionService.purgeExpiredEvidence({ dryRun: false });

      // Phase 8: External Provider Data Retention (30-day unreferenced signal purge)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const purgedSignals = this.db.prepare(`
        DELETE FROM monitoring_signals
        WHERE source_type = 'external_provider'
          AND observed_at < ?
          AND id NOT IN (SELECT signal_id FROM signal_case_links)
      `).run(thirtyDaysAgo);

      // Purge expired or consumed OAuth state nonces (> 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const purgedNonces = this.db.prepare(`
        DELETE FROM oauth_state_nonces
        WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)
      `).run(oneDayAgo, oneDayAgo);

      const combinedResult = {
        ...result,
        purgedProviderSignals: purgedSignals.changes,
        purgedOAuthNonces: purgedNonces.changes
      };

      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'idle', duration, combinedResult);
      return combinedResult;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Retention worker failed', err);
      throw err;
    }
  }

  /**
   * 2. Statutory Clock Monitoring Worker
   */
  public async runStatutoryClockWorker(): Promise<Record<string, any>> {
    const workerName = 'statutory_clock_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const nowIso = new Date().toISOString();
      const activeClocks = this.db
        .prepare(`
          SELECT sc.*, c.case_number, c.title, c.organization_id, c.assigned_to_user_id
          FROM statutory_clocks sc
          JOIN cases c ON sc.case_id = c.id
          WHERE sc.current_status IN ('running', 'due_soon')
        `)
        .all() as any[];

      let overdueCount = 0;
      let alertedCount = 0;

      for (const clock of activeClocks) {
        if (clock.submission_deadline && clock.submission_deadline < nowIso) {
          // Transition to overdue
          this.db
            .prepare(`UPDATE statutory_clocks SET current_status = 'overdue', updated_at = ? WHERE id = ?`)
            .run(nowIso, clock.id);

          overdueCount++;

          // Queue alert notification if assigned user exists
          if (clock.assigned_to_user_id) {
            const dateStr = nowIso.slice(0, 10);
            const idempotencyKey = `clock_overdue_${clock.id}_${dateStr}`;
            try {
              this.notificationService.queueNotification({
                organization_id: clock.organization_id,
                user_id: clock.assigned_to_user_id,
                title: `STATUTORY CLOCK OVERDUE: Case ${clock.case_number}`,
                body: `Statutory clock for Case ${clock.case_number} (${clock.operational_basis || clock.operational_rule || 'Intermediary Guidelines'}) has exceeded its submission deadline.`,
                notification_type: 'clock_overdue',
                idempotency_key: idempotencyKey,
                delivery_channel: 'in_app'
              });
              alertedCount++;
            } catch (err) {
              // Ignore unique constraint on idempotencyKey
            }
          }
        }
      }

      const duration = Date.now() - start;
      const metadata = { evaluated: activeClocks.length, overdueCount, alertedCount };
      this.updateHeartbeat(workerName, 'idle', duration, metadata);
      return metadata;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Statutory clock worker failed', err);
      throw err;
    }
  }

  /**
   * 3. Transactional Outbox Notification Delivery Worker
   */
  public async runNotificationWorker(): Promise<Record<string, any>> {
    const workerName = 'notification_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const result = await this.notificationService.processOutboxBatch(25);
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'idle', duration, result);
      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Notification worker failed', err);
      throw err;
    }
  }

  /**
   * 4. Usage Metering Aggregation Worker
   */
  public async runUsageAggregationWorker(): Promise<Record<string, any>> {
    const workerName = 'usage_aggregation_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      // Re-aggregate any events from today and yesterday
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const orgs = this.db.prepare('SELECT id FROM organizations').all() as { id: string }[];
      let updatedAggregates = 0;

      for (const org of orgs) {
        for (const date of [yesterday, today]) {
          const events = this.db
            .prepare(`
              SELECT event_type, SUM(quantity) as sum_qty
              FROM usage_events
              WHERE organization_id = ? AND recorded_at LIKE ?
              GROUP BY event_type
            `)
            .all(org.id, `${date}%`) as { event_type: string; sum_qty: number }[];

          for (const ev of events) {
            this.db
              .prepare(`
                INSERT INTO usage_daily_aggregates (id, organization_id, date, event_type, total_quantity, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(organization_id, date, event_type) DO UPDATE SET
                  total_quantity = excluded.total_quantity,
                  updated_at = excluded.updated_at
              `)
              .run(
                `agg_${org.id.slice(0, 8)}_${date}_${ev.event_type}`,
                org.id,
                date,
                ev.event_type,
                ev.sum_qty,
                new Date().toISOString()
              );
            updatedAggregates++;
          }
        }
      }

      const duration = Date.now() - start;
      const metadata = { orgsProcessed: orgs.length, updatedAggregates };
      this.updateHeartbeat(workerName, 'idle', duration, metadata);
      return metadata;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Usage aggregation worker failed', err);
      throw err;
    }
  }

  /**
   * 5. Automated Backup Verification Worker
   */
  public async runBackupVerificationWorker(): Promise<Record<string, any>> {
    const workerName = 'backup_verification_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const backups = this.backupService.listBackups();
      let verificationResult: any = { status: 'no_backups_found' };

      if (backups.length > 0) {
        const latest = backups[0];
        verificationResult = this.backupService.verifyBackup(latest.backup_id);
      }

      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'idle', duration, verificationResult);
      return verificationResult;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Backup verification worker failed', err);
      throw err;
    }
  }

  /**
   * 6. Monitoring Ingestion Worker (Safe offline simulation & intake sweep)
   */
  public async runMonitoringIngestionWorker(): Promise<Record<string, any>> {
    const workerName = 'monitoring_ingestion_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const activePolicies = this.db.prepare(`
        SELECT p.*, s.canonical_name, s.organization_id, s.monitoring_status
        FROM monitoring_policies p
        JOIN monitored_subjects s ON p.subject_id = s.id
        WHERE p.is_active = 1 AND s.monitoring_status = 'active'
      `).all() as any[];

      let ingestedCount = 0;
      let duplicatesCount = 0;

      for (const policy of activePolicies) {
        const adapters: string[] = JSON.parse(policy.enabled_adapters || '[]');
        if (adapters.includes('local_fixture')) {
          const fixtures = this.localFixtureAdapter.loadFixtures();
          for (const fix of fixtures) {
            try {
              const res = this.signalService.ingestSignal(policy.organization_id, 'system_worker', {
                subject_id: policy.subject_id,
                policy_id: policy.id,
                adapter_name: 'local_fixture',
                source_type: 'local_fixture',
                observed_url: fix.observed_url,
                platform: fix.platform,
                content_type: fix.content_type || 'profile',
                raw_payload: fix.raw_payload,
                provenance: { worker_run: true, ...fix.provenance }
              });
              if (res.isDuplicate) {
                duplicatesCount++;
              } else {
                ingestedCount++;
              }
            } catch {
              // Ignore quota exceeded or individual errors in background loop
            }
          }
        }
      }

      const duration = Date.now() - start;
      const metadata = { policiesEvaluated: activePolicies.length, ingestedCount, duplicatesCount };
      this.updateHeartbeat(workerName, 'idle', duration, metadata);
      return metadata;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Monitoring ingestion worker failed', err);
      throw err;
    }
  }

  /**
   * 7. Candidate Evaluation & Risk Correlation Worker
   */
  public async runCandidateEvaluationWorker(): Promise<Record<string, any>> {
    const workerName = 'candidate_evaluation_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const pendingSignals = this.db.prepare(`
        SELECT * FROM monitoring_signals WHERE processing_status = 'pending' LIMIT 50
      `).all() as any[];

      let evaluatedCount = 0;
      let alertsTriggered = 0;

      for (const rawSig of pendingSignals) {
        const subject = this.subjectService.getSubjectById(rawSig.subject_id);
        if (!subject) continue;

        const policy = rawSig.policy_id
          ? this.policyService.getPolicy(rawSig.organization_id, rawSig.policy_id)
          : this.policyService.getPolicyBySubjectId(rawSig.organization_id, rawSig.subject_id);

        const mappedSignal = {
          ...rawSig,
          provenance: JSON.parse(rawSig.provenance || '{}'),
          raw_payload: rawSig.raw_payload
        };

        const result = this.correlationService.correlate(mappedSignal, subject, policy);
        evaluatedCount++;

        const alertThresh = (policy?.alert_threshold ?? 0.7) * 100;
        if (result.riskScore >= alertThresh) {
          try {
            this.notificationService.queueNotification({
              organization_id: rawSig.organization_id,
              title: `MONITORING ALERT: Candidate match for ${subject.canonical_name}`,
              body: `High risk candidate (${result.riskScore}/100) observed on ${mappedSignal.platform}: ${mappedSignal.normalized_url}. Mandatory human review required.`,
              notification_type: 'monitoring_alert_triggered',
              idempotency_key: `notif_alert_${rawSig.id}`,
              delivery_channel: 'in_app'
            });
            alertsTriggered++;
          } catch {
            // Ignore duplicate notification keys
          }
        }
      }

      const duration = Date.now() - start;
      const metadata = { evaluatedCount, alertsTriggered };
      this.updateHeartbeat(workerName, 'idle', duration, metadata);
      return metadata;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Candidate evaluation worker failed', err);
      throw err;
    }
  }

  /**
   * 8. Provider Sync Worker (Phase 8: Controlled Read-Only Provider Synchronization)
   */
  public async runProviderSyncWorker(): Promise<Record<string, any>> {
    const workerName = 'provider_sync_worker';
    const start = Date.now();
    this.updateHeartbeat(workerName, 'running');
    try {
      const result = await this.providerSyncService.syncAllActiveConnections();
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'idle', duration, result);
      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      this.updateHeartbeat(workerName, 'error', duration, null, err.message);
      this.logger.error('Provider sync worker failed', err);
      throw err;
    }
  }

  /**
   * List all registered background worker names
   */
  public listWorkers(): string[] {
    return [
      'retention_worker',
      'statutory_clock_worker',
      'notification_worker',
      'usage_aggregation_worker',
      'backup_verification_worker',
      'monitoring_ingestion_worker',
      'candidate_evaluation_worker',
      'provider_sync_worker'
    ];
  }

  /**
   * Run an individual worker on demand
   */
  public async runWorkerOnce(workerName: string): Promise<Record<string, any>> {
    const normalized = workerName
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');

    switch (normalized) {
      case 'retention_worker':
        return this.runRetentionWorker();
      case 'statutory_clock_worker':
        return this.runStatutoryClockWorker();
      case 'notification_worker':
        return this.runNotificationWorker();
      case 'usage_aggregation_worker':
        return this.runUsageAggregationWorker();
      case 'backup_verification_worker':
        return this.runBackupVerificationWorker();
      case 'monitoring_ingestion_worker':
        return this.runMonitoringIngestionWorker();
      case 'candidate_evaluation_worker':
        return this.runCandidateEvaluationWorker();
      case 'provider_sync_worker':
        return this.runProviderSyncWorker();
      default:
        throw new Error(`Unknown worker: ${workerName}`);
    }
  }

  /**
   * Start scheduled intervals for all workers
   */
  public startAll(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const config = getConfig();

    // 1. Retention Worker
    const retentionInterval = setInterval(
      () => this.runRetentionWorker().catch(() => {}),
      config.workers.retentionIntervalMs
    );
    this.intervals.set('retention_worker', retentionInterval);

    // 2. Statutory Clock Worker
    const clockInterval = setInterval(
      () => this.runStatutoryClockWorker().catch(() => {}),
      config.workers.clockIntervalMs
    );
    this.intervals.set('statutory_clock_worker', clockInterval);

    // 3. Notification Outbox Worker
    const notificationInterval = setInterval(
      () => this.runNotificationWorker().catch(() => {}),
      config.workers.notificationIntervalMs
    );
    this.intervals.set('notification_worker', notificationInterval);

    // 4. Usage Aggregation Worker
    const usageInterval = setInterval(
      () => this.runUsageAggregationWorker().catch(() => {}),
      config.workers.usageIntervalMs
    );
    this.intervals.set('usage_aggregation_worker', usageInterval);

    // 5. Backup Verification Worker
    const backupInterval = setInterval(
      () => this.runBackupVerificationWorker().catch(() => {}),
      config.workers.backupVerifyIntervalMs
    );
    this.intervals.set('backup_verification_worker', backupInterval);

    // 6. Monitoring Ingestion Worker
    const monitoringIngestionInterval = setInterval(
      () => this.runMonitoringIngestionWorker().catch(() => {}),
      config.workers.monitoringIngestionIntervalMs
    );
    this.intervals.set('monitoring_ingestion_worker', monitoringIngestionInterval);

    // 7. Candidate Evaluation Worker
    const candidateEvaluationInterval = setInterval(
      () => this.runCandidateEvaluationWorker().catch(() => {}),
      config.workers.candidateEvaluationIntervalMs
    );
    this.intervals.set('candidate_evaluation_worker', candidateEvaluationInterval);

    // 8. Provider Sync Worker
    const providerSyncInterval = setInterval(
      () => this.runProviderSyncWorker().catch(() => {}),
      60000
    );
    this.intervals.set('provider_sync_worker', providerSyncInterval);

    this.logger.info('All 8 operational background workers started successfully');
  }

  /**
   * Stop all scheduled workers cleanly
   */
  public stopAll(): void {
    for (const [name, interval] of this.intervals.entries()) {
      clearInterval(interval);
      this.updateHeartbeat(name, 'stopped');
    }
    this.intervals.clear();
    this.isRunning = false;
    this.logger.info('All background workers stopped');
  }

  public getHeartbeats(): WorkerStatus[] {
    return this.db
      .prepare('SELECT * FROM worker_heartbeats ORDER BY worker_name ASC')
      .all() as WorkerStatus[];
  }

  /**
   * Registers OS signal handlers for graceful process termination
   */
  public setupGracefulShutdown(): void {
    const shutdownHandler = (signal: string) => {
      this.logger.info(`Received ${signal}. Gracefully stopping all background workers...`);
      this.stopAll();
    };

    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.once('SIGINT', () => shutdownHandler('SIGINT'));
  }
}
