# Background Worker Operations & Scheduled Automation

## 1. Overview & Architecture

The **Digital Impersonation Response Desk** relies on an embedded, resilient worker orchestration system managed by `WorkerManager`.

Rather than requiring an external queue system (Redis, RabbitMQ, Celery), background jobs run as lightweight, non-blocking scheduled loops inside the main Node.js process. Each worker records its execution status and duration in SQLite for full operational observability.

---

## 2. Background Worker Inventory

The system registers **5 automated operational workers**:

| Worker Identifier | Scheduled Interval | Service Handled | Core Responsibility |
| :--- | :--- | :--- | :--- |
| `retention_worker` | 60,000 ms (1 min) | `RetentionService` | Scans for evidence older than retention window (default: 180 days). Purges expired artifacts while preserving tombstones and respecting legal holds. |
| `statutory_clock_worker` | 60,000 ms (1 min) | `StatutoryClockService` | Evaluates active IT Rules 2021 statutory clocks. Transitions overdue clocks and dispatches alert notifications. |
| `notification_worker` | 10,000 ms (10 sec) | `NotificationService` | Sweeps `notification_outbox` for pending alerts, delivers via local adapters, increments attempts up to max retries. |
| `usage_aggregation_worker`| 60,000 ms (1 min) | `UsageMeteringService` | Aggregates raw `usage_events` for today and yesterday into persistent `usage_daily_aggregates` records. |
| `backup_verification_worker`| 3,600,000 ms (1 hr)| `BackupService` | Inspects latest backup archive, re-computes SHA-256 checksums, and alerts if corruption is detected. |

---

## 3. Worker Heartbeats & Observability

Every worker lifecycle event (start, complete, error, stop) updates the `worker_heartbeats` table:

```sql
CREATE TABLE worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL, -- running, idle, stopped, error
  last_heartbeat_at TEXT NOT NULL,
  last_run_duration_ms REAL,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata TEXT
);
```

### Inspecting Heartbeats via API
```http
GET /api/admin/workers
Authorization: Bearer <system_admin_token>
```

**Response (HTTP 200)**:
```json
{
  "success": true,
  "data": [
    {
      "worker_name": "statutory_clock_worker",
      "status": "idle",
      "last_heartbeat_at": "2026-09-12T17:03:00.000Z",
      "last_run_duration_ms": 12,
      "iteration_count": 42,
      "error_count": 0,
      "last_error": null,
      "metadata": "{\"evaluated\":12,\"overdueCount\":0,\"alertedCount\":0}"
    }
  ]
}
```

---

## 4. On-Demand Worker Execution

In addition to scheduled timers, operators can trigger any worker on-demand via the Operator Console UI or REST API:

```http
POST /api/admin/workers/statutory_clock_worker/run
Authorization: Bearer <system_admin_token>
```

**Response (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "evaluated": 12,
    "overdueCount": 1,
    "alertedCount": 1
  }
}
```

---

## 5. Graceful Shutdown & Lifecycle Management

When the process receives `SIGINT` or `SIGTERM`:
1. `workerManager.stopAll()` clears all active `setInterval` timers.
2. Active worker iterations are allowed to finish their current database transaction.
3. Worker statuses transition to `'stopped'` in `worker_heartbeats`.
4. Database connection pools close cleanly without leaving abandoned locks or partial WAL checkpoints.
