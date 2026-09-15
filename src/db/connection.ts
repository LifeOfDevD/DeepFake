import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getConfig } from '../config/env.js';

let defaultDb: Database.Database | null = null;

export interface DatabaseOptions {
  dbPath?: string;
  inMemory?: boolean;
}

export function createDatabaseConnection(options: DatabaseOptions = {}): Database.Database {
  let db: Database.Database;

  if (options.inMemory) {
    db = new Database(':memory:');
  } else {
    const rawPath = options.dbPath || getConfig().databasePath;
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(resolvedPath);
  }

  // Enforce critical database pragmas
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  
  // WAL mode is only valid for persistent disk files
  if (!options.inMemory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB memory cache
  }

  return db;
}

export function getDatabase(options: DatabaseOptions = {}): Database.Database {
  if (!defaultDb) {
    defaultDb = createDatabaseConnection(options);
  }
  return defaultDb;
}

export function setDatabaseInstance(db: Database.Database): void {
  if (defaultDb && defaultDb.open) {
    defaultDb.close();
  }
  defaultDb = db;
}

export function closeDatabase(): void {
  if (defaultDb && defaultDb.open) {
    defaultDb.close();
  }
}

export interface DatabaseHealthReport {
  healthy: boolean;
  latencyMs: number;
  walMode: boolean;
  foreignKeys: boolean;
  error?: string;
}

/**
 * Executes a deterministic health check query against the database
 */
export function checkDatabaseHealth(dbInstance?: Database.Database): DatabaseHealthReport {
  const start = Date.now();
  try {
    const db = dbInstance || getDatabase();
    db.prepare('SELECT 1 as ping').get();

    const fk = db.pragma('foreign_keys', { simple: true });
    const jm = db.pragma('journal_mode', { simple: true });

    return {
      healthy: true,
      latencyMs: Date.now() - start,
      walMode: typeof jm === 'string' && jm.toLowerCase() === 'wal',
      foreignKeys: fk === 1
    };
  } catch (err: any) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      walMode: false,
      foreignKeys: false,
      error: err.message || 'Database ping query failed'
    };
  }
}

