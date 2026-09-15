# Disaster Recovery & Business Continuity Plan

## Executive Summary & Target Service Levels

| Metric | Target Objective | Definition |
| :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | **1 Hour** | Maximum permissible duration of transactional data loss in an unrecoverable disaster. |
| **RTO (Recovery Time Objective)** | **15 Minutes** | Maximum allowable elapsed time to restore operational service in an isolated environment. |
| **Backup Cadence** | **Hourly** | Non-blocking Write-Ahead-Logging (WAL) snapshots via SQLite Online Backup API. |
| **Backup Retention** | **30 Days** | Daily retention cycle purges backups older than 30 days unless subject to legal hold. |

---

## 1. Backup Architecture

The platform utilizes a dual-tier atomic snapshot architecture implemented in `BackupService`:
1. **Database Snapshot**: Created via SQLite `backup()` API. Ensures consistent ACID state without holding read/write database locks or pausing active transactions.
2. **Evidence Assets Snapshot**: Mirrors stored digital evidence files and metadata sidecars into the backup container.
3. **Cryptographic Manifest (`backup-manifest.json`)**: Records:
   - SHA-256 hash of the database snapshot.
   - Per-file SHA-256 hashes and byte sizes for all evidence items.
   - Row count baseline across all tables (`cases`, `evidence_items`, `organizations`, `audit_events`, `legal_holds`).

---

## 2. Isolated Restore Drill Protocol

To ensure disaster recovery preparedness without risking live production state, all restore drills strictly enforce the **Isolated Target Invariant**:
> **Strict Rule**: Backups must NEVER be restored directly over the active production database directory. Any restore command targeting an active database path is rejected immediately with `Error: Cannot restore directly into active database directory`.

### Drill Steps:
1. **Select Backup Archive**: Locate the target snapshot folder (e.g. `/storage/backups/backup_2026-09-13T10-00-00-000Z/`).
2. **Cryptographic Manifest Verification**:
   - `BackupService.verifyBackup(backupDir)` recalculates the SHA-256 hash of the database file and all evidence artifacts.
   - If any checksum fails or a file is missing, restore is aborted.
3. **Target Isolation**:
   - Restore database file to an isolated staging directory (e.g. `/tmp/dr_restore_20260913/restored.sqlite`).
4. **Schema and Table Count Audit**:
   - Open isolated database in read-only mode.
   - Verify table counts match the manifest baseline.
5. **Cold-Start Validation**:
   - Start an isolated worker process instance against the restored database to confirm clean startup and absence of lock contention.

---

## 3. Disaster Scenarios & Recovery Workflows

### Scenario A: Unrecoverable Host Storage Failure
1. Provision replacement instance with base OS and Node.js 22 runtime.
2. Pull latest hourly backup from off-site / object storage vault.
3. Verify manifest checksums:
   ```bash
   npm run verify-backup -- --path="/backups/latest"
   ```
4. Restore database and evidence assets to production paths.
5. Run migration check:
   ```bash
   npm run migrate
   ```
6. Start application with `NODE_ENV=production`. Verify `/healthz/ready` returns HTTP 200.

### Scenario B: Database File Corruption
1. Activate emergency kill switch to suspend incoming webhooks and sync polling:
   ```bash
   curl -X POST http://localhost:4000/api/integrations/kill-switch -H "Content-Type: application/json" -d '{"active": true, "reason": "DB Corruption Isolation"}'
   ```
2. Move corrupted database file to forensic quarantine directory `/var/log/quarantine/`.
3. Restore last verified hourly snapshot to target directory.
4. Execute `/api/monitoring/simulate-cycle` to replay pending signal evaluations.
5. Disarm kill switch and resume normal operations.
