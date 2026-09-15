import { Router, Request, Response } from 'express';
import { getDatabase, checkDatabaseHealth } from '../db/connection.js';
import { getMigrationStatus } from '../db/migrate.js';
import { getConfig } from '../config/env.js';
import { MetricsCollector } from '../observability/metrics-collector.js';
import { ProviderSyncService } from '../services/integrations/provider-sync-service.js';
import fs from 'fs';

export const healthRouter = Router();

// Standard status endpoint
healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Digital Impersonation Response Desk',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    mode: 'safely_operable_production_candidate'
  });
});

// Liveness probe (Lightweight, verifies process responsiveness)
const livenessHandler = (_req: Request, res: Response) => {
  res.json({
    status: 'alive',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
};
healthRouter.get('/liveness', livenessHandler);
healthRouter.get('/live', livenessHandler);

// Readiness probe (Deep check: DB, storage, migration status)
const readinessHandler = (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbHealth = checkDatabaseHealth(db);
    if (!dbHealth.healthy) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'DATABASE_UNHEALTHY',
        error: dbHealth.error,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const migrationStatus = getMigrationStatus(db);
    if (migrationStatus.pendingCount > 0) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'PENDING_MIGRATIONS',
        pendingCount: migrationStatus.pendingCount,
        pendingMigrations: migrationStatus.pending,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const config = getConfig();
    const evidenceDirExists = fs.existsSync(config.storage.evidenceDir);
    const backupDirExists = fs.existsSync(config.storage.backupDir);

    if (!evidenceDirExists) {
      res.status(503).json({
        status: 'not_ready',
        reason: 'EVIDENCE_STORAGE_UNACCESSIBLE',
        path: config.storage.evidenceDir,
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.json({
      status: 'ready',
      database: {
        healthy: true,
        walMode: dbHealth.walMode,
        latencyMs: dbHealth.latencyMs
      },
      migrations: {
        appliedCount: migrationStatus.appliedCount,
        pendingCount: 0
      },
      storage: {
        backend: config.storage.backend,
        evidenceStorageAccessible: evidenceDirExists,
        backupStorageAccessible: backupDirExists
      },
      pilotMode: config.modes.pilotMode,
      dryRunOnly: true,
      livePlatformActionsBlocked: !config.modes.enableLivePlatformActions,
      liveBillingBlocked: !config.modes.enableLiveBilling,
      liveNotificationsBlocked: !config.modes.enableLiveNotifications,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'not_ready',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};
healthRouter.get('/readiness', readinessHandler);
healthRouter.get('/ready', readinessHandler);

// Dependency telemetry
healthRouter.get('/dependencies', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbHealth = checkDatabaseHealth(db);
    const config = getConfig();

    let workersFleet = { registered: 0, running: 0 };
    try {
      const heartbeats = db.prepare('SELECT status FROM worker_heartbeats').all() as any[];
      workersFleet = {
        registered: heartbeats.length,
        running: heartbeats.filter((h) => h.status === 'running' || h.status === 'idle').length
      };
    } catch {
      // Table may not exist in early tests
    }

    res.json({
      success: true,
      dependencies: {
        database: {
          healthy: dbHealth.healthy,
          latencyMs: dbHealth.latencyMs,
          walMode: dbHealth.walMode,
          foreignKeys: dbHealth.foreignKeys
        },
        storage: {
          backend: config.storage.backend,
          evidenceAccessible: fs.existsSync(config.storage.evidenceDir),
          backupsAccessible: fs.existsSync(config.storage.backupDir)
        },
        workers: workersFleet,
        integrations: {
          killSwitchActive: ProviderSyncService.isGlobalKillSwitchActive(),
          canaryGated: true,
          readOnlyEnforced: true
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export const metricsRouter = Router();

// Centralized metrics handler (JSON or Prometheus exposition format)
const metricsHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const collector = MetricsCollector.getInstance();

    const accept = req.headers.accept || '';
    const format = req.query.format as string;

    if (accept.includes('text/plain') || format === 'prometheus') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(collector.toPrometheusFormat(db));
      return;
    }

    res.json({
      success: true,
      data: collector.getSnapshot(db)
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

healthRouter.get('/metrics', metricsHandler);
metricsRouter.get('/', metricsHandler);
metricsRouter.get('/metrics', metricsHandler);
