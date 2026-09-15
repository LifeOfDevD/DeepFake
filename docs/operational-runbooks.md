# Operational Site Reliability Engineering (SRE) Runbooks

**Document Version:** 1.0.0  
**System:** Digital Impersonation Response Desk  
**Target Environment:** Staging / Production Canary  
**On-Call Tier:** L1 Triage / L2 SRE / L3 Security & Platform Engineering  

---

## Runbook Index

1. [RUNBOOK-01: External Provider Outage / Circuit Breaker Trip](#runbook-01-external-provider-outage--circuit-breaker-trip)
2. [RUNBOOK-02: Database Locking Contention & Health Degradation](#runbook-02-database-locking-contention--health-degradation)
3. [RUNBOOK-03: Managed Object Storage & KMS Key Outage](#runbook-03-managed-object-storage--kms-key-outage)
4. [RUNBOOK-04: Background Worker Fleet Failure & Stale Heartbeats](#runbook-04-background-worker-fleet-failure--stale-heartbeats)
5. [RUNBOOK-05: Master Encryption Key & Session Secret Compromise](#runbook-05-master-encryption-key--session-secret-compromise)
6. [RUNBOOK-06: Potential Tenant Isolation Breach / Cross-Tenant Access Alert](#runbook-06-potential-tenant-isolation-breach--cross-tenant-access-alert)
7. [RUNBOOK-07: Evidence Retention / Deletion Worker Failure](#runbook-07-evidence-retention--deletion-worker-failure)
8. [RUNBOOK-08: Disaster Recovery, Backup Restoration & Point-in-Time Recovery](#runbook-08-disaster-recovery-backup-restoration--point-in-time-recovery)
9. [RUNBOOK-09: Distributed Brute-Force & Application Security Incident](#runbook-09-distributed-brute-force--application-security-incident)
10. [RUNBOOK-10: Production Canary Deployment Failure & Rollback](#runbook-10-production-canary-deployment-failure--rollback)
11. [RUNBOOK-11: Provider OAuth Refresh Token Compromise / Revocation](#runbook-11-provider-oauth-refresh-token-compromise--revocation)
12. [RUNBOOK-12: Emergency Global Kill-Switch Activation & Restoration](#runbook-12-emergency-global-kill-switch-activation--restoration)
13. [RUNBOOK-13: Upstream Provider Terms of Service / API Policy Change](#runbook-13-upstream-provider-terms-of-service--api-policy-change)

---

### RUNBOOK-01: External Provider Outage / Circuit Breaker Trip

* **Severity:** P2 (High)
* **Trigger:** Metric `response_desk_circuit_trips_total > 0` or 5 consecutive 502/503/504 errors on provider sync.
* **Immediate Containment:**
  1. Circuit breaker automatically transitions to `open` state, shedding outbound traffic and shielding API quotas.
  2. Verify that `ProviderSyncService.getCircuitStatus(connectionId)` reports `circuit_state: 'open'`.
* **Investigation:**
  - Check third-party provider status dashboard (e.g. Google Cloud / YouTube Status Dashboard).
  - Inspect structured logs for `external_provider_call_failed` with `statusCode >= 500`.
* **Remediation:**
  - Allow the circuit breaker 60-second cooldown period to transition to `half-open`.
  - If upstream outage persists beyond 2 hours, notify affected tenant admins via in-app banner.
* **Verification:**
  - Monitor `response_desk_provider_sync_total` metric recovering with status `200` upon upstream recovery.

---

### RUNBOOK-02: Database Locking Contention & Health Degradation

* **Severity:** P1 (Critical)
* **Trigger:** Healthcheck probe `/healthz/ready` returns HTTP 503 (`DATABASE_UNHEALTHY`) or `response_desk_database_ping_latency_ms > 500`.
* **Immediate Containment:**
  1. Freeze high-volume batch ingestion workers by pausing ingestion schedules.
  2. Check for long-running uncommitted transactions or orphaned SQLite connection locks.
* **Investigation:**
  - Check disk space: `df -h /data`.
  - Check SQLite journal mode: `PRAGMA journal_mode;` must return `wal`.
  - Check busy timeout: `PRAGMA busy_timeout;` must return `5000`.
* **Remediation:**
  - Execute safe checkpoint: `PRAGMA wal_checkpoint(TRUNCATE);`.
  - If write-lock deadlocked, gracefully restart the application container (`docker restart response-desk-app`).
* **Verification:**
  - Probe `GET /healthz/ready` — verify `database.healthy: true` and latency `< 10ms`.

---

### RUNBOOK-03: Managed Object Storage & KMS Key Outage

* **Severity:** P1 (Critical)
* **Trigger:** Evidence upload or presigned URL download fails; `/healthz/dependencies` reports `evidenceAccessible: false`.
* **Immediate Containment:**
  - If AWS S3 or KMS is down, put application in read-only maintenance mode (`RATE_LIMIT_ENABLED=true`, throttle new uploads).
* **Investigation:**
  - Inspect AWS CloudWatch metrics for S3 5xx errors or KMS `AccessDeniedException` / `KMSDisabledException`.
  - Verify IAM credentials and role expiration attached to the container instance.
* **Remediation:**
  - If KMS key policy was accidentally modified, restore IAM key usage permissions for the desk execution role.
  - If S3 bucket permissions altered, re-apply Terraform/CloudFormation storage policy.
* **Verification:**
  - Execute synthetic test upload and presigned URL retrieval using test tenant credentials.

---

### RUNBOOK-04: Background Worker Fleet Failure & Stale Heartbeats

* **Severity:** P2 (High)
* **Trigger:** Metric `response_desk_worker_count{state="running"} < 7` or worker heartbeat timestamp `> 3 * interval`.
* **Immediate Containment:**
  1. Determine which specific worker stopped (Retention, Clock, Notifications, Usage, Backup, Ingestion, Evaluation).
  2. Review application error logs filtering by `worker_error`.
* **Investigation:**
  - Check uncaught rejection or memory exhaustion in Node.js event loop.
  - Check worker table: `SELECT * FROM worker_heartbeats WHERE last_heartbeat < datetime('now', '-5 minutes');`.
* **Remediation:**
  - Issue worker restart signal via `WorkerManager.restartWorker(workerName)` or container restart.
* **Verification:**
  - Query `SELECT worker_name, status, last_heartbeat FROM worker_heartbeats;` ensuring all 7 workers show active timestamps.

---

### RUNBOOK-05: Master Encryption Key & Session Secret Compromise

* **Severity:** P1 (Emergency / Security Breach)
* **Trigger:** Credential leak detected in version control, crash dump, or server compromise.
* **Immediate Containment:**
  1. Generate new 64-character random key: `openssl rand -hex 32`.
  2. Set `ENCRYPTION_MASTER_KEY=<new_key>` and move compromised key to `ENCRYPTION_FALLBACK_KEYS=<compromised_key>`.
  3. Deploy updated environment configuration and restart application.
* **Investigation & Remediation:**
  - Execute automated token re-encryption script: `SecretsManager.reencryptAllProviderTokens(db)`.
  - Invalidate all active user sessions by rotating `SESSION_SECRET` (forces re-login for all active users).
  - Once re-encryption is verified, remove the compromised key completely from `ENCRYPTION_FALLBACK_KEYS`.
* **Verification:**
  - Verify that existing provider integrations continue syncing successfully without fallback keys.
  - Audit log entries created for every re-encrypted secret.

---

### RUNBOOK-06: Potential Tenant Isolation Breach / Cross-Tenant Access Alert

* **Severity:** P1 (Critical Security)
* **Trigger:** Security log alert `cross_tenant_access_attempt` or HTTP 403 where `session.org_id != resource.org_id`.
* **Immediate Containment:**
  1. Immediately suspend the requesting user account: `UPDATE users SET active = 0 WHERE id = ?;`.
  2. Terminate active session tokens for that user identifier.
* **Investigation:**
  - Correlate `audit_events` by `actor_id` over the past 72 hours.
  - Identify whether access was attempted via URL parameter tampering (BOLA/IDOR), forged token, or API bug.
* **Remediation:**
  - If code defect identified, apply immediate hotfix and deploy via canary pipeline.
  - Conduct forensic audit on affected victim tenant records to verify no data was read or mutated.
* **Verification:**
  - Run `tests/security/red-team.test.ts` and verify 100% pass across all multi-tenant isolation scenarios.

---

### RUNBOOK-07: Evidence Retention / Deletion Worker Failure

* **Severity:** P2 (High)
* **Trigger:** `response_desk_worker_errors_total` increments during `RetentionWorker` execution.
* **Immediate Containment:**
  - Confirm that deletion failure is NOT caused by an unhandled exception crashing other services.
* **Investigation:**
  - Inspect if the target evidence file has an active legal hold (`legal_hold = 1` in `evidence_items` or active entry in `legal_holds`).
  - Check storage backend permissions for S3 `DeleteObject` action.
* **Remediation:**
  - If evidence was blocked due to legal hold, verify hold legitimacy with legal compliance officer.
  - If storage permission error, refresh IAM policy for deletion role.
* **Verification:**
  - Re-run retention sweep manually and verify status transition to `purged` in `evidence_items` and audit log.

---

### RUNBOOK-08: Disaster Recovery, Backup Restoration & Point-in-Time Recovery

* **Severity:** P1 (Disaster Event)
* **Trigger:** Catastrophic database corruption, accidental drop, or node failure.
* **Procedure:**
  1. **DO NOT overwrite the active database path directly.**
  2. Locate the latest verified backup from `/storage/backups/backup_YYYYMMDD_HHMMSS.sqlite`.
  3. Verify backup checksum: `sha256sum <backup_file>` against the `.sha256` sidecar.
  4. Perform test restore into an isolated staging location:
     `cp <backup_file> /tmp/isolated_restore.sqlite`
  5. Run integrity check: `sqlite3 /tmp/isolated_restore.sqlite "PRAGMA integrity_check;"`.
  6. Swap database under maintenance window:
     - Stop application: `docker stop response-desk-app`.
     - Move corrupted database to `/data/corrupted_archive.sqlite`.
     - Copy verified restore to `/data/response_desk.sqlite`.
     - Start application: `docker start response-desk-app`.
  7. Verify `/healthz/ready` returns HTTP 200 with 0 pending migrations.

---

### RUNBOOK-09: Distributed Brute-Force & Application Security Incident

* **Severity:** P2 (High)
* **Trigger:** High volume of 401 Unauthorized responses or multiple account lockouts tripped within 5 minutes.
* **Immediate Containment:**
  1. AccountLockoutService automatically locks accounts for 15 minutes after 5 failed attempts.
  2. Rate limiters (`authRateLimiter`) throttle client IP to 10 requests/minute.
* **Investigation:**
  - Inspect IP addresses and user-agent distribution in structured logs.
  - Check if attack is distributed across a proxy network or concentrated on specific high-profile accounts.
* **Remediation:**
  - Add offending IP CIDR blocks to edge WAF (Cloudflare / AWS WAF / NGINX reverse proxy).
  - If credential stuffing targeted specific employees, trigger administrative password reset and session invalidation.
* **Verification:**
  - Confirm rate of 401s normalizes and legitimate user logins proceed without obstruction.

---

### RUNBOOK-10: Production Canary Deployment Failure & Rollback

* **Severity:** P1 (Deployment Incident)
* **Trigger:** Post-deployment synthetic tests fail, or error rate exceeds 1% during Canary Stage 1 or 2.
* **Procedure:**
  1. Immediately redirect reverse proxy traffic 100% back to Blue (stable version).
  2. Stop and drain Canary (Green) containers: `docker stop response-desk-green`.
  3. Verify database migration compatibility:
     - All migrations must adhere to backward-compatible expansion rules (additive columns only).
     - No destructive column drops permitted during canary phase.
  4. Probe Blue `/healthz/ready` to ensure stable cluster is serving traffic normally.
  5. Convene deployment post-mortem before re-attempting rollout.

---

### RUNBOOK-11: Provider OAuth Refresh Token Compromise / Revocation

* **Severity:** P2 (High)
* **Trigger:** External platform notifies of token revocation, or API returns 401 Invalid Grant during token refresh.
* **Immediate Containment:**
  1. Mark provider connection status as `revoked`:
     `UPDATE provider_connections SET status = 'revoked' WHERE id = ?;`.
  2. Suppress automated sync queries for that connection to avoid triggering account-level API ban.
* **Investigation:**
  - Contact the organization tenant administrator who authorized the integration.
  - Determine if token was manually revoked in platform settings or expired due to lack of use.
* **Remediation:**
  - Organization admin re-authenticates via the OAuth consent flow (`POST /api/integrations/:id/reconnect`).
  - SecretsManager re-encrypts fresh refresh and access tokens.
* **Verification:**
  - Trigger single-channel test sync and verify HTTP 200 response and timestamp update.

---

### RUNBOOK-12: Emergency Global Kill-Switch Activation & Restoration

* **Severity:** P1 (Emergency Kill-Switch)
* **Trigger:** Uncontrolled external API calls detected, suspected platform Terms of Service issue, or legal injunction.
* **Activation Procedure:**
  1. Authenticated System Admin invokes kill-switch API or sets environment variable:
     `curl -X POST http://localhost:4000/api/admin/kill-switch -H "Authorization: Bearer <ADMIN_TOKEN>"`
     OR set in `.env`: `GLOBAL_INTEGRATION_KILL_SWITCH=true` and restart app.
  2. All external outbound synchronization, WebSub subscriptions, and candidate evaluations are cut off instantaneously with zero outbound network calls.
* **Restoration Procedure:**
  1. Obtain written sign-off from Incident Commander and Legal Counsel.
  2. Disengage kill-switch:
     `curl -X DELETE http://localhost:4000/api/admin/kill-switch -H "Authorization: Bearer <ADMIN_TOKEN>"`.
* **Verification:**
  - Confirm `ProviderSyncService.isGlobalKillSwitchActive()` returns `false`.
  - Verify sync tasks resume in controlled, rate-limited batches.

---

### RUNBOOK-13: Upstream Provider Terms of Service / API Policy Change

* **Severity:** P3 (Medium / Policy)
* **Trigger:** Third-party platform (Google/YouTube, Meta, X) deprecates an endpoint or restricts read-only impersonation triage scopes.
* **Immediate Containment:**
  - Verify that current usage strictly adheres to read-only search/channel inspection (`youtube.readonly`).
  - Ensure no automated write actions (commenting, reporting) are triggered.
* **Investigation & Remediation:**
  - Review developer policy update notice with Compliance & Legal.
  - Update data retention mappings if the platform mandates reduced caching of public metadata.
  - If a specific endpoint is restricted, adjust the provider adapter plugin to utilize alternative compliant metadata fields.
* **Verification:**
  - Run provider integration test suite against provider sandbox or recorded HTTP fixtures.
