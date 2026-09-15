import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';

export interface LatencyHistogram {
  count: number;
  totalDurationMs: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricSnapshot {
  timestamp: string;
  application: {
    totalRequests: number;
    requestsByStatus: Record<string, number>;
    authFailures: number;
    authzFailures: number;
    latency: LatencyHistogram;
  };
  database: {
    healthy: boolean;
    pingLatencyMs: number;
    tableCounts: Record<string, number>;
  };
  storage: {
    uploadsCount: number;
    downloadsCount: number;
    deletionCount: number;
    errorsCount: number;
  };
  workers: {
    registeredCount: number;
    runningCount: number;
    errorCount: number;
  };
  provider: {
    syncRuns: number;
    websubPushes: number;
    circuitOpenCount: number;
    quotaExceededCount: number;
  };
}

/**
 * Enterprise Production Metrics Collector
 * Collects latency histograms, error rates, database health, worker stats, and provider telemetry.
 * Exports metrics in JSON and standard Prometheus exposition formats.
 */
export class MetricsCollector {
  private static instance: MetricsCollector;

  private totalRequests = 0;
  private requestsByStatus: Record<string, number> = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0
  };
  private authFailures = 0;
  private authzFailures = 0;
  private latencies: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 2000;

  // Storage metrics
  private uploadsCount = 0;
  private downloadsCount = 0;
  private deletionCount = 0;
  private storageErrors = 0;

  // Provider metrics
  private providerSyncRuns = 0;
  private websubPushes = 0;
  private circuitOpenEvents = 0;
  private quotaExceededEvents = 0;

  public static getInstance(): MetricsCollector {
    if (!this.instance) {
      this.instance = new MetricsCollector();
    }
    return this.instance;
  }

  public recordHttpRequest(statusCode: number, durationMs: number): void {
    this.totalRequests++;

    const statusGroup = `${Math.floor(statusCode / 100)}xx`;
    this.requestsByStatus[statusGroup] = (this.requestsByStatus[statusGroup] || 0) + 1;

    if (statusCode === 401) {
      this.authFailures++;
    } else if (statusCode === 403) {
      this.authzFailures++;
    }

    if (this.latencies.length >= this.MAX_LATENCY_SAMPLES) {
      this.latencies.shift(); // Evict oldest
    }
    this.latencies.push(durationMs);
  }

  public recordStorageUpload(_bytes: number): void {
    this.uploadsCount++;
  }

  public recordStorageDownload(): void {
    this.downloadsCount++;
  }

  public recordStorageDelete(): void {
    this.deletionCount++;
  }

  public recordStorageError(): void {
    this.storageErrors++;
  }

  public recordProviderSync(_success: boolean): void {
    this.providerSyncRuns++;
  }

  public recordWebSubPush(): void {
    this.websubPushes++;
  }

  public recordCircuitTrip(): void {
    this.circuitOpenEvents++;
  }

  public recordQuotaExceeded(): void {
    this.quotaExceededEvents++;
  }

  private calculateHistogram(): LatencyHistogram {
    if (this.latencies.length === 0) {
      return { count: 0, totalDurationMs: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const count = sorted.length;
    const totalDurationMs = sorted.reduce((acc, v) => acc + v, 0);

    const p50 = sorted[Math.floor(count * 0.5)] || 0;
    const p95 = sorted[Math.floor(count * 0.95)] || sorted[count - 1] || 0;
    const p99 = sorted[Math.floor(count * 0.99)] || sorted[count - 1] || 0;

    return {
      count,
      totalDurationMs,
      p50: Math.round(p50 * 100) / 100,
      p95: Math.round(p95 * 100) / 100,
      p99: Math.round(p99 * 100) / 100
    };
  }

  public getSnapshot(dbInstance?: Database.Database): MetricSnapshot {
    const db = dbInstance || getDatabase();
    let dbHealthy = false;
    let pingLatency = 0;
    const tableCounts: Record<string, number> = {};

    try {
      const pingStart = Date.now();
      db.prepare('SELECT 1').get();
      pingLatency = Date.now() - pingStart;
      dbHealthy = true;

      const tables = ['organizations', 'cases', 'evidence_items', 'monitoring_signals', 'candidate_reviews', 'audit_events'];
      for (const tbl of tables) {
        try {
          const res = db.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as any;
          tableCounts[tbl] = res?.c || 0;
        } catch {
          tableCounts[tbl] = 0;
        }
      }
    } catch {
      dbHealthy = false;
    }

    // Workers telemetry
    let workerStats = { registeredCount: 0, runningCount: 0, errorCount: 0 };
    try {
      const rows = db.prepare('SELECT status, error_count FROM worker_heartbeats').all() as any[];
      workerStats = {
        registeredCount: rows.length,
        runningCount: rows.filter((r) => r.status === 'running' || r.status === 'idle').length,
        errorCount: rows.reduce((acc, r) => acc + (r.error_count || 0), 0)
      };
    } catch {
      // Table may not exist in early tests
    }

    return {
      timestamp: new Date().toISOString(),
      application: {
        totalRequests: this.totalRequests,
        requestsByStatus: { ...this.requestsByStatus },
        authFailures: this.authFailures,
        authzFailures: this.authzFailures,
        latency: this.calculateHistogram()
      },
      database: {
        healthy: dbHealthy,
        pingLatencyMs: pingLatency,
        tableCounts
      },
      storage: {
        uploadsCount: this.uploadsCount,
        downloadsCount: this.downloadsCount,
        deletionCount: this.deletionCount,
        errorsCount: this.storageErrors
      },
      workers: workerStats,
      provider: {
        syncRuns: this.providerSyncRuns,
        websubPushes: this.websubPushes,
        circuitOpenCount: this.circuitOpenEvents,
        quotaExceededCount: this.quotaExceededEvents
      }
    };
  }

  /**
   * Serializes metrics into standard Prometheus exposition format
   */
  public toPrometheusFormat(dbInstance?: Database.Database): string {
    const snap = this.getSnapshot(dbInstance);
    const lines: string[] = [];

    lines.push('# HELP response_desk_http_requests_total Total HTTP requests');
    lines.push('# TYPE response_desk_http_requests_total counter');
    lines.push(`response_desk_http_requests_total ${snap.application.totalRequests}`);

    for (const [status, count] of Object.entries(snap.application.requestsByStatus)) {
      lines.push(`response_desk_http_requests_by_status{status="${status}"} ${count}`);
    }

    lines.push('# HELP response_desk_auth_failures_total Total authentication failures (401)');
    lines.push('# TYPE response_desk_auth_failures_total counter');
    lines.push(`response_desk_auth_failures_total ${snap.application.authFailures}`);

    lines.push('# HELP response_desk_authz_failures_total Total authorization failures (403)');
    lines.push('# TYPE response_desk_authz_failures_total counter');
    lines.push(`response_desk_authz_failures_total ${snap.application.authzFailures}`);

    lines.push('# HELP response_desk_http_latency_ms HTTP latency percentiles');
    lines.push('# TYPE response_desk_http_latency_ms gauge');
    lines.push(`response_desk_http_latency_ms{quantile="0.5"} ${snap.application.latency.p50}`);
    lines.push(`response_desk_http_latency_ms{quantile="0.95"} ${snap.application.latency.p95}`);
    lines.push(`response_desk_http_latency_ms{quantile="0.99"} ${snap.application.latency.p99}`);

    lines.push('# HELP response_desk_database_healthy Database connection status (1=healthy, 0=unhealthy)');
    lines.push('# TYPE response_desk_database_healthy gauge');
    lines.push(`response_desk_database_healthy ${snap.database.healthy ? 1 : 0}`);
    lines.push(`response_desk_database_ping_latency_ms ${snap.database.pingLatencyMs}`);

    for (const [table, count] of Object.entries(snap.database.tableCounts)) {
      lines.push(`response_desk_db_rows{table="${table}"} ${count}`);
    }

    lines.push('# HELP response_desk_worker_count Worker fleet telemetry');
    lines.push('# TYPE response_desk_worker_count gauge');
    lines.push(`response_desk_worker_count{state="registered"} ${snap.workers.registeredCount}`);
    lines.push(`response_desk_worker_count{state="running"} ${snap.workers.runningCount}`);
    lines.push(`response_desk_worker_errors_total ${snap.workers.errorCount}`);

    lines.push('# HELP response_desk_provider_sync_total External provider sync runs');
    lines.push('# TYPE response_desk_provider_sync_total counter');
    lines.push(`response_desk_provider_sync_total ${snap.provider.syncRuns}`);
    lines.push(`response_desk_websub_pushes_total ${snap.provider.websubPushes}`);
    lines.push(`response_desk_circuit_trips_total ${snap.provider.circuitOpenCount}`);

    return lines.join('\n') + '\n';
  }

  public reset(): void {
    this.totalRequests = 0;
    this.requestsByStatus = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    this.authFailures = 0;
    this.authzFailures = 0;
    this.latencies = [];
    this.uploadsCount = 0;
    this.downloadsCount = 0;
    this.deletionCount = 0;
    this.storageErrors = 0;
    this.providerSyncRuns = 0;
    this.websubPushes = 0;
    this.circuitOpenEvents = 0;
    this.quotaExceededEvents = 0;
  }
}

/**
 * Express middleware that automatically tracks HTTP request telemetry
 */
export function metricsHttpMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const collector = MetricsCollector.getInstance();

  res.on('finish', () => {
    const duration = Date.now() - start;
    collector.recordHttpRequest(res.statusCode, duration);
  });

  next();
}
