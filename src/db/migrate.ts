import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(dbInstance?: Database.Database): void {
  const db = dbInstance || getDatabase();

  // 1. Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // 2. Locate migrations directory (robust for TS and compiled JS)
  let migrationsDir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');
  }

  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const alreadyApplied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(file);
      if (!alreadyApplied) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        const applyTx = db.transaction(() => {
          db.exec(sql);
          db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
        });
        applyTx();
      }
    }
  } else {
    // Fallback to consolidated schema.sql
    let schemaPath = path.resolve(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
    }
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }
}

export interface MigrationStatus {
  appliedCount: number;
  pendingCount: number;
  applied: { id: string; applied_at: string }[];
  pending: string[];
}

/**
 * Returns audit status of applied and pending migrations
 */
export function getMigrationStatus(dbInstance?: Database.Database): MigrationStatus {
  const db = dbInstance || getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  let migrationsDir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');
  }

  const diskFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    : [];

  const appliedRows = db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id ASC').all() as {
    id: string;
    applied_at: string;
  }[];

  const appliedMap = new Set(appliedRows.map((r) => r.id));
  const pending = diskFiles.filter((f) => !appliedMap.has(f));

  return {
    appliedCount: appliedRows.length,
    pendingCount: pending.length,
    applied: appliedRows,
    pending
  };
}

// Standalone execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running versioned database migrations...');
  runMigrations();
  console.log('Migrations applied successfully.');
}
