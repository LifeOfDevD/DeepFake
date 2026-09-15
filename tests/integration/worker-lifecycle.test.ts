import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { WorkerManager } from '../../src/workers/worker-manager.js';
import { NotificationService } from '../../src/services/notification-service.js';

describe('Integration: Worker Lifecycle & Scheduled Operations', () => {
  let db: any;
  let manager: WorkerManager;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    manager = new WorkerManager();
  });

  afterEach(() => {
    manager.stopAll();
    closeDatabase();
  });

  it('registers all 8 background operational workers', () => {
    const list = manager.listWorkers();
    expect(list.length).toBe(8);
    expect(list).toContain('retention_worker');
    expect(list).toContain('statutory_clock_worker');
    expect(list).toContain('notification_worker');
    expect(list).toContain('usage_aggregation_worker');
    expect(list).toContain('backup_verification_worker');
    expect(list).toContain('monitoring_ingestion_worker');
    expect(list).toContain('candidate_evaluation_worker');
    expect(list).toContain('provider_sync_worker');
  });

  it('executes NotificationWorker on demand and updates heartbeat records', async () => {
    // Queue a notification
    const notificationService = new NotificationService();
    notificationService.queueNotification({
      organization_id: 'org_apex_health_01',
      recipient: 'usr_apex_mgr_02',
      title: 'Worker Test',
      body: 'Testing worker run',
      notification_type: 'clock_due_soon',
      delivery_channel: 'in_app'
    });

    const result = await manager.runWorkerOnce('notification_worker');
    expect(result).toBeDefined();
    expect(result.processed).toBeGreaterThanOrEqual(1);

    // Verify heartbeat in database
    const heartbeat = db.prepare('SELECT * FROM worker_heartbeats WHERE worker_name = ?').get('notification_worker') as any;
    expect(heartbeat).toBeDefined();
    expect(heartbeat.status).toBe('idle');
    expect(heartbeat.iteration_count).toBeGreaterThanOrEqual(1);
    expect(heartbeat.last_heartbeat_at).toBeDefined();
  });

  it('executes StatutoryClockWorker and records execution heartbeat', async () => {
    const result = await manager.runWorkerOnce('statutory_clock_worker');
    expect(result).toBeDefined();
    expect(result.evaluated).toBeGreaterThanOrEqual(0);

    const heartbeat = db.prepare('SELECT * FROM worker_heartbeats WHERE worker_name = ?').get('statutory_clock_worker') as any;
    expect(heartbeat.status).toBe('idle');
    expect(heartbeat.last_run_duration_ms).toBeGreaterThanOrEqual(0);
    expect(heartbeat.iteration_count).toBeGreaterThanOrEqual(1);
  });

  it('executes UsageAggregationWorker and aggregates pending events', async () => {
    const result = await manager.runWorkerOnce('usage_aggregation_worker');
    expect(result).toBeDefined();
    expect(result.orgsProcessed).toBeGreaterThanOrEqual(1);

    const heartbeat = db.prepare('SELECT * FROM worker_heartbeats WHERE worker_name = ?').get('usage_aggregation_worker') as any;
    expect(heartbeat.status).toBe('idle');
    expect(heartbeat.iteration_count).toBeGreaterThanOrEqual(1);
  });

  it('executes MonitoringIngestionWorker and records operational heartbeat', async () => {
    const result = await manager.runWorkerOnce('monitoring_ingestion_worker');
    expect(result).toBeDefined();
    expect(result.policiesEvaluated).toBeGreaterThanOrEqual(0);

    const heartbeat = db.prepare('SELECT * FROM worker_heartbeats WHERE worker_name = ?').get('monitoring_ingestion_worker') as any;
    expect(heartbeat).toBeDefined();
    expect(heartbeat.status).toBe('idle');
    expect(heartbeat.iteration_count).toBeGreaterThanOrEqual(1);
  });

  it('executes CandidateEvaluationWorker and records operational heartbeat', async () => {
    const result = await manager.runWorkerOnce('candidate_evaluation_worker');
    expect(result).toBeDefined();
    expect(result.evaluatedCount).toBeGreaterThanOrEqual(0);

    const heartbeat = db.prepare('SELECT * FROM worker_heartbeats WHERE worker_name = ?').get('candidate_evaluation_worker') as any;
    expect(heartbeat).toBeDefined();
    expect(heartbeat.status).toBe('idle');
    expect(heartbeat.iteration_count).toBeGreaterThanOrEqual(1);
  });
});
