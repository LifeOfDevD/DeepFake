# Backup, Verification & Recovery Runbook

## 1. Overview & Resilience Guarantees

The **Digital Impersonation Response Desk** maintains institutional-grade data durability and regulatory chain of custody through an atomic, WAL-safe backup architecture.

- **Recovery Point Objective (RPO)**: <= 1 hour (via automated periodic backup runs).
- **Recovery Time Objective (RTO)**: < 15 minutes (via isolated non-destructive restore drills).
- **Cryptographic Tamper-Evidence**: Every backup snapshot includes a signed JSON manifest with SHA-256 checksums for the database and all quarantined evidence files.

---

## 2. WAL-Safe Backup Architecture

Because SQLite operates in **Write-Ahead Logging (WAL)** mode, simple file copy (`cp impersonation_desk.db`) risks copying inconsistent or torn pages if active writes are occurring.

To guarantee zero corruption:
1. **SQLite Backup API**: `BackupService` invokes the official native SQLite Online Backup API (`db.backup(targetPath)`). This safely locks pages and streams a consistent snapshot without blocking concurrent reads or writes.
2. **Evidence Artifact Mirroring**: Evidence files in `/storage/evidence` are mirrored recursively with exact byte sizes and SHA-256 hashes recorded in the manifest.
3. **Table Count Snapshots**: Row counts for core audit and entity tables (`organizations`, `users`, `cases`, `evidence_items`, `statutory_clocks`, `submissions`, `audit_events`) are captured.

### 2.1 Manifest Schema (`backup-manifest.json`)

```json
{
  "version": "1.0.0",
  "backup_id": "backup_2026-09-12T17-02-16-784Z",
  "timestamp": "2026-09-12T17:02:16.784Z",
  "database_filename": "response_desk_backup.sqlite",
  "database_sha256": "059e9025da5fb0ded140ecbf9d266435bdaa3675e33574975d5cbadcbb452b8b",
  "database_size_bytes": 102400,
  "evidence_file_count": 14,
  "evidence_total_bytes": 4892300,
  "evidence_manifest": [
    {
      "relative_path": "org_apex_health_01/case_001/evidence_001.png",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size_bytes": 349120
    }
  ],
  "table_counts": {
    "organizations": 3,
    "users": 10,
    "cases": 24,
    "evidence_items": 14,
    "statutory_clocks": 12,
    "submissions": 18,
    "audit_events": 142
  }
}
```

---

## 3. Creating & Verifying Backups via Operator Console / API

### Create Backup Snapshot
```http
POST /api/admin/backups/create
Content-Type: application/json
Authorization: Bearer <system_admin_token>
```

**Response (HTTP 201)**:
```json
{
  "success": true,
  "data": {
    "backupId": "backup_2026-09-12T17-02-16-784Z",
    "backupDir": "/app/storage/backups/backup_2026-09-12T17-02-16-784Z",
    "databaseBackupPath": "/app/storage/backups/backup_2026-09-12T17-02-16-784Z/response_desk_backup.sqlite",
    "manifest": { ... }
  }
}
```

### Verify Backup Integrity
```http
POST /api/admin/backups/backup_2026-09-12T17-02-16-784Z/verify
Authorization: Bearer <system_admin_token>
```

**Response (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "databaseIntact": true,
    "evidenceFilesVerified": 14,
    "errors": []
  }
}
```

---

## 4. Non-Destructive Restore Drills

> [!CAUTION]
> **Strict Non-Destructive Safety Invariant**: The recovery engine strictly prohibits restoring directly into the active database directory (`/app/data`). Restore drills must target an isolated verification directory to prevent accidental data overwrites.

```typescript
const service = new BackupService();

// Execute non-destructive restore drill into isolated test sandbox
const result = await service.restoreToIsolatedTarget(
  'backup_2026-09-12T17-02-16-784Z',
  '/tmp/restore-drill-20260912'
);

console.log(`Drill success: ${result.success}`);
console.log(`Verified table count: ${result.tableCount}`);
console.log(`Verified org count: ${result.organizationCount}`);
```

During the drill, the engine:
1. Validates `backup-manifest.json` and recalculates SHA-256 sums.
2. Copies the database snapshot to the isolated target directory.
3. Opens the isolated database in readonly mode.
4. Asserts that row counts match the manifest record counts.
5. Verifies that legal holds and deleted tombstones remain intact.
6. Closes and unmounts the isolated instance.

---

## 5. Cold Disaster Recovery Runbook

In the catastrophic event of host machine failure or volume loss:

1. **Deploy New Host**: Provision a fresh VM or container environment using `docker-compose.yml`.
2. **Mount Cold Storage**: Retrieve the latest verified backup archive from offsite/cloud object storage.
3. **Place Database**: Extract `response_desk_backup.sqlite` to `/app/data/impersonation_desk.db`.
4. **Place Evidence**: Extract `evidence/` contents to `/app/storage/evidence/`.
5. **Run Migrations**: Run `npm run migrate` to ensure schema definitions match the software release.
6. **Start Application**: Launch `docker compose up -d`.
7. **Verify Readiness**: Query `GET http://localhost:4000/health/readiness` to confirm 100% operational status.
