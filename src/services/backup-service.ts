import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/env.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';

export interface BackupEvidenceItem {
  relative_path: string;
  sha256: string;
  size_bytes: number;
}

export interface BackupManifest {
  version: '1.0.0';
  backup_id?: string;
  evidence_count?: number;
  timestamp: string;
  database_filename: string;
  database_sha256: string;
  database_size_bytes: number;
  evidence_file_count: number;
  evidence_total_bytes: number;
  evidence_manifest: BackupEvidenceItem[];
  table_counts: Record<string, number>;
}

export class BackupService {
  private auditService: AuditService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
  }

  private computeFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Creates an atomic backup snapshot of SQLite and evidence assets with cryptographic manifest
   */
  public async createBackup(
    customDestDirOrLabel?: string,
    actor?: ActorContext
  ): Promise<{
    backupId: string;
    backupDir: string;
    databaseBackupPath: string;
    manifest: BackupManifest & { backup_id: string; evidence_count: number };
  }> {
    const isExplicitDir =
      customDestDirOrLabel &&
      !customDestDirOrLabel.includes(' ') &&
      (customDestDirOrLabel.startsWith('.') ||
        customDestDirOrLabel.startsWith('/') ||
        customDestDirOrLabel.includes('\\') ||
        (fs.existsSync(customDestDirOrLabel) && fs.statSync(customDestDirOrLabel).isDirectory()));

    const baseDir = (isExplicitDir ? customDestDirOrLabel : undefined) || getConfig().storage.backupDir;
    const nowIso = new Date().toISOString();
    const folderName = `backup_${nowIso.replace(/[:.]/g, '-')}`;
    const backupDir = path.resolve(process.cwd(), path.join(baseDir, folderName));

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbBackupFilename = 'response_desk_backup.sqlite';
    const dbBackupPath = path.join(backupDir, dbBackupFilename);

    // 1. Non-blocking WAL-safe snapshot using SQLite backup API
    await this.db.backup(dbBackupPath);

    const dbHash = this.computeFileHash(dbBackupPath);
    const dbStats = fs.statSync(dbBackupPath);

    // 2. Backup Evidence Storage
    const sourceEvidenceDir = path.resolve(process.cwd(), getConfig().storage.evidenceDir);
    const targetEvidenceDir = path.join(backupDir, 'evidence');
    if (!fs.existsSync(targetEvidenceDir)) {
      fs.mkdirSync(targetEvidenceDir, { recursive: true });
    }

    const evidenceItems: BackupEvidenceItem[] = [];
    let totalEvidenceBytes = 0;

    if (fs.existsSync(sourceEvidenceDir)) {
      const copyFiles = (src: string, dest: string, relPrefix = '') => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          const relPath = path.join(relPrefix, entry.name);

          if (entry.isDirectory()) {
            if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
            copyFiles(srcPath, destPath, relPath);
          } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
            const fileHash = this.computeFileHash(srcPath);
            const stats = fs.statSync(srcPath);
            totalEvidenceBytes += stats.size;
            evidenceItems.push({
              relative_path: relPath,
              sha256: fileHash,
              size_bytes: stats.size
            });
          }
        }
      };
      copyFiles(sourceEvidenceDir, targetEvidenceDir);
    }

    // 3. Count database records
    const tables = [
      'organizations',
      'users',
      'memberships',
      'cases',
      'evidence_items',
      'statutory_clocks',
      'submissions',
      'audit_events'
    ];
    const tableCounts: Record<string, number> = {};

    for (const tbl of tables) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).get() as { cnt: number } | undefined;
        tableCounts[tbl] = row ? row.cnt : 0;
      } catch {
        tableCounts[tbl] = 0;
      }
    }

    const manifest: BackupManifest & { backup_id: string; evidence_count: number } = {
      version: '1.0.0',
      backup_id: folderName,
      timestamp: nowIso,
      database_filename: dbBackupFilename,
      database_sha256: dbHash,
      database_size_bytes: dbStats.size,
      evidence_file_count: evidenceItems.length,
      evidence_count: evidenceItems.length,
      evidence_total_bytes: totalEvidenceBytes,
      evidence_manifest: evidenceItems,
      table_counts: tableCounts
    };

    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    if (actor) {
      this.auditService.record({
        organization_id: (actor as any).organization_id || 'system',
        actor_user_id: actor.user_id,
        actor_email: actor.email,
        action: 'backup.created',
        resource_type: 'backup',
        resource_id: folderName,
        details: { backupDir, database_sha256: dbHash, evidence_file_count: evidenceItems.length }
      });
    }

    return {
      backupId: folderName,
      backupDir,
      databaseBackupPath: dbBackupPath,
      manifest
    };
  }

  /**
   * Lists available backup archives in descending order of creation
   */
  public listBackups(baseDir?: string): { backup_id: string; dir: string; timestamp: string; sizeBytes: number }[] {
    const dir = baseDir || getConfig().storage.backupDir;
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith('backup_'))
      .map((e) => {
        const fullPath = path.join(dir, e.name);
        const manifestPath = path.join(fullPath, 'backup-manifest.json');
        let timestamp = '';
        let sizeBytes = 0;
        if (fs.existsSync(manifestPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            timestamp = m.timestamp;
            sizeBytes = m.database_size_bytes + m.evidence_total_bytes;
          } catch {}
        }
        return {
          backup_id: e.name,
          dir: fullPath,
          timestamp: timestamp || fs.statSync(fullPath).birthtime.toISOString(),
          sizeBytes
        };
      })
      .sort((a, b) => b.backup_id.localeCompare(a.backup_id));
  }

  /**
   * Verifies the cryptographic integrity of a backup folder against its manifest
   */
  public verifyBackup(backupDirOrId: string): {
    isValid: boolean;
    databaseIntact: boolean;
    evidenceFilesVerified: number;
    errors: string[];
  } {
    if (!backupDirOrId) {
      return {
        isValid: false,
        databaseIntact: false,
        evidenceFilesVerified: 0,
        errors: ['No backup directory or ID provided.']
      };
    }

    let backupDir = backupDirOrId;
    if (!fs.existsSync(backupDir)) {
      const candidates = [
        path.join(getConfig().storage.backupDir, backupDirOrId),
        path.join(process.cwd(), getConfig().storage.backupDir, backupDirOrId),
        path.join(process.cwd(), 'storage', 'backups', backupDirOrId),
        path.join(process.cwd(), 'data', 'test-backups', backupDirOrId)
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          backupDir = cand;
          break;
        }
      }
    }

    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return {
        isValid: false,
        databaseIntact: false,
        evidenceFilesVerified: 0,
        errors: ['Manifest file backup-manifest.json not found in backup directory.']
      };
    }

    const errors: string[] = [];
    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let databaseIntact = false;

    // Check database file
    const dbPath = path.join(backupDir, manifest.database_filename);
    if (!fs.existsSync(dbPath)) {
      errors.push(`Database file '${manifest.database_filename}' is missing.`);
    } else {
      const dbHash = this.computeFileHash(dbPath);
      if (dbHash !== manifest.database_sha256) {
        errors.push(`Database checksum mismatch! Expected ${manifest.database_sha256}, got ${dbHash}.`);
      } else {
        databaseIntact = true;
      }
    }

    // Check evidence files
    const evidenceBase = path.join(backupDir, 'evidence');
    let evidenceFilesVerified = 0;
    for (const item of manifest.evidence_manifest || []) {
      const itemPath = path.join(evidenceBase, item.relative_path);
      if (!fs.existsSync(itemPath)) {
        errors.push(`Evidence artifact missing: ${item.relative_path}`);
      } else {
        const itemHash = this.computeFileHash(itemPath);
        if (itemHash !== item.sha256) {
          errors.push(`Evidence file '${item.relative_path}' checksum mismatch!`);
        } else {
          evidenceFilesVerified++;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      databaseIntact,
      evidenceFilesVerified,
      errors
    };
  }

  /**
   * Restores a backup non-destructively to an ISOLATED target directory
   * Strict invariant: Never overwrites or touches the active production/runtime database!
   */
  public async restoreToIsolatedTarget(
    backupIdOrDir: string,
    targetTestDir: string
  ): Promise<{
    success: boolean;
    restoredDatabasePath: string;
    tableCount: number;
    organizationCount: number;
    verifiedTables: Record<string, number>;
    errors: string[];
  }> {
    const resolvedTarget = path.resolve(targetTestDir);
    const activeDbDir = path.resolve(process.cwd(), 'data');
    const configDbDir = path.dirname(path.resolve(process.cwd(), getConfig().databasePath));

    if (resolvedTarget === activeDbDir || resolvedTarget === configDbDir) {
      throw new Error(
        'Cannot restore directly into active database directory. Restores must target isolated directory.'
      );
    }

    let backupDir = backupIdOrDir;
    if (!fs.existsSync(backupDir)) {
      const candidates = [
        path.join(getConfig().storage.backupDir, backupIdOrDir),
        path.join(process.cwd(), getConfig().storage.backupDir, backupIdOrDir),
        path.join(process.cwd(), 'storage', 'backups', backupIdOrDir),
        path.join(process.cwd(), 'data', 'test-backups', backupIdOrDir)
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          backupDir = cand;
          break;
        }
      }
    }

    const verification = this.verifyBackup(backupDir);
    if (!verification.isValid) {
      throw new Error(`Backup verification failed: ${verification.errors.join(', ')}`);
    }

    if (!fs.existsSync(targetTestDir)) {
      fs.mkdirSync(targetTestDir, { recursive: true });
    }

    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const restoredDatabasePath = path.join(targetTestDir, 'restored.sqlite');
    fs.copyFileSync(path.join(backupDir, manifest.database_filename), restoredDatabasePath);

    let testDb: Database.Database | null = null;
    let tableCount = 0;
    let organizationCount = 0;
    const verifiedTables: Record<string, number> = {};
    const errors: string[] = [];

    try {
      testDb = new Database(restoredDatabasePath, { readonly: true });
      const tableRows = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      tableCount = tableRows.length;

      try {
        const orgRow = testDb.prepare('SELECT COUNT(*) as c FROM organizations').get() as { c: number } | undefined;
        organizationCount = orgRow?.c ?? 0;
      } catch {}

      for (const [tbl, expectedCnt] of Object.entries(manifest.table_counts || {})) {
        try {
          const row = testDb.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).get() as { cnt: number };
          verifiedTables[tbl] = row.cnt;
          if (row.cnt !== expectedCnt) {
            errors.push(`Table '${tbl}' row count mismatch: expected ${expectedCnt}, found ${row.cnt}.`);
          }
        } catch (err: any) {
          errors.push(`Failed to query table '${tbl}': ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Failed to inspect restored database: ${err.message}`);
    } finally {
      if (testDb) {
        testDb.close();
      }
    }

    return {
      success: errors.length === 0,
      restoredDatabasePath,
      tableCount,
      organizationCount,
      verifiedTables,
      errors
    };
  }

  /**
   * Restores a backup into an ISOLATED test directory and tests all integrity assertions
   * Strict invariant: Never overwrites or modifies active production/test databases!
   */
  public restoreToIsolatedDirectory(
    backupDir: string,
    targetTestDir: string
  ): { success: boolean; verifiedTables: Record<string, number>; errors: string[] } {
    const resolvedTarget = path.resolve(targetTestDir);
    const activeDbDir = path.resolve(process.cwd(), 'data');
    if (resolvedTarget === activeDbDir) {
      throw new Error(
        'Cannot restore directly into active database directory. Restores must target isolated directory.'
      );
    }

    const verifyResult = this.verifyBackup(backupDir);
    if (!verifyResult.isValid) {
      return { success: false, verifiedTables: {}, errors: verifyResult.errors };
    }

    if (!fs.existsSync(targetTestDir)) {
      fs.mkdirSync(targetTestDir, { recursive: true });
    }

    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Copy DB file into isolated dir
    const isolatedDbPath = path.join(targetTestDir, 'restored.sqlite');
    fs.copyFileSync(path.join(backupDir, manifest.database_filename), isolatedDbPath);

    // Open isolated DB and run verification checks
    let testDb: Database.Database | null = null;
    const errors: string[] = [];
    const verifiedTables: Record<string, number> = {};

    try {
      testDb = new Database(isolatedDbPath, { readonly: true });

      for (const [tbl, expectedCnt] of Object.entries(manifest.table_counts)) {
        try {
          const row = testDb.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).get() as { cnt: number };
          verifiedTables[tbl] = row.cnt;
          if (row.cnt !== expectedCnt) {
            errors.push(`Table '${tbl}' row count mismatch: expected ${expectedCnt}, found ${row.cnt}.`);
          }
        } catch (err: any) {
          errors.push(`Failed to query table '${tbl}': ${err.message}`);
        }
      }

      // Verify legal holds and tombstones
      const holdCount = (testDb.prepare('SELECT COUNT(*) as cnt FROM evidence_items WHERE legal_hold = 1').get() as any).cnt;
      const deletedCount = (testDb.prepare("SELECT COUNT(*) as cnt FROM evidence_items WHERE status = 'deleted'").get() as any).cnt;

      verifiedTables.legal_holds = holdCount;
      verifiedTables.deleted_tombstones = deletedCount;
    } catch (err: any) {
      errors.push(`Failed to open or inspect restored database: ${err.message}`);
    } finally {
      if (testDb) {
        testDb.close();
      }
    }

    return {
      success: errors.length === 0,
      verifiedTables,
      errors
    };
  }
}
