import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { BackupService } from '../../src/services/backup-service.js';

describe('Unit: WAL-Safe Backup & Recovery Service', () => {
  let db: any;
  let service: BackupService;
  const testBackupDir = path.join(process.cwd(), 'data', 'test-backups');
  const testRestoreDir = path.join(process.cwd(), 'data', 'test-restores');

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    service = new BackupService();

    if (!fs.existsSync(testBackupDir)) fs.mkdirSync(testBackupDir, { recursive: true });
    if (!fs.existsSync(testRestoreDir)) fs.mkdirSync(testRestoreDir, { recursive: true });
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testBackupDir)) fs.rmSync(testBackupDir, { recursive: true, force: true });
    if (fs.existsSync(testRestoreDir)) fs.rmSync(testRestoreDir, { recursive: true, force: true });
  });

  it('creates a WAL-safe backup with manifest and cryptographic checksums', async () => {
    const result = await service.createBackup('Automated test backup');

    expect(result.backupId).toBeDefined();
    expect(result.databaseBackupPath).toBeDefined();
    expect(fs.existsSync(result.databaseBackupPath)).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest.backup_id).toBe(result.backupId);
    expect(result.manifest.database_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest.evidence_count).toBeGreaterThanOrEqual(0);
  });

  it('verifies a valid backup successfully against manifest checksums', async () => {
    const backup = await service.createBackup('Verification test');
    const verification = service.verifyBackup(backup.backupId);

    expect(verification.isValid).toBe(true);
    expect(verification.databaseIntact).toBe(true);
    expect(verification.evidenceFilesVerified).toBe(backup.manifest.evidence_count);
    expect(verification.errors.length).toBe(0);
  });

  it('restores backup non-destructively to an isolated test target directory', async () => {
    const backup = await service.createBackup('Restore drill test');
    const targetDir = path.join(testRestoreDir, `restore-${Date.now()}`);

    const restoreResult = await service.restoreToIsolatedTarget(backup.backupId, targetDir);

    expect(restoreResult.success).toBe(true);
    expect(fs.existsSync(restoreResult.restoredDatabasePath)).toBe(true);
    expect(restoreResult.tableCount).toBeGreaterThan(10);
    expect(restoreResult.organizationCount).toBeGreaterThanOrEqual(1);

    // Assert that active database connection remains untouched
    const activeOrgCount = (db.prepare('SELECT COUNT(*) as c FROM organizations').get() as any).c;
    expect(activeOrgCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects restore attempt targeting production or active database path', async () => {
    const backup = await service.createBackup('Safety test');
    const activeDbDir = path.dirname(path.join(process.cwd(), 'data', 'impersonation_desk.db'));

    await expect(service.restoreToIsolatedTarget(backup.backupId, activeDbDir)).rejects.toThrowError(
      /Cannot restore directly into active database directory/
    );
  });
});
