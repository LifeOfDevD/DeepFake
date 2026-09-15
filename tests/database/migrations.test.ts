import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Database: Migrations & Foreign Key Integrity', () => {
  it('applies migrations cleanly to an empty in-memory database', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    expect(() => runMigrations(db)).not.toThrow();

    // Verify all tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('organizations');
    expect(tables).toContain('users');
    expect(tables).toContain('cases');
    expect(tables).toContain('evidence_items');
    expect(tables).toContain('evidence_access_events');
    expect(tables).toContain('evidence_retention_holds');
    expect(tables).toContain('schema_migrations');

    db.close();
  });

  it('applies migrations idempotently when executed repeatedly', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    runMigrations(db);
    // Running second and third time must not throw
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();

    db.close();
  });

  it('applies Phase 2 migration successfully to an existing Phase 1 seeded database', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run seed which runs migrations and seeds cases
    seedDemoData(db);

    const cases = db.prepare('SELECT COUNT(*) as count FROM cases').get() as { count: number };
    expect(cases.count).toBeGreaterThan(0);

    // Re-run migrations
    expect(() => runMigrations(db)).not.toThrow();

    // Verify evidence tables are ready
    const evidenceCount = db.prepare('SELECT COUNT(*) as count FROM evidence_items').get() as { count: number };
    expect(evidenceCount.count).toBe(0);

    db.close();
  });

  it('enforces foreign keys preventing evidence creation without a valid case', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedDemoData(db);

    // Attempt to insert evidence with non-existent case_id
    const insertStmt = db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename,
        safe_display_name, mime_type, detected_mime_type, byte_size,
        sha256, storage_key, status, sensitivity, source_url,
        captured_at, uploaded_at, uploaded_by, retention_until,
        legal_hold, created_at, updated_at
      ) VALUES (
        'ev_orphan', 'org_apex_health_01', 'case_non_existent', 'image', 'test.png',
        'test.png', 'image/png', 'image/png', 100,
        'sha256fake', 'storage/key', 'available', 'normal', NULL,
        '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'usr_apex_mgr_02', '2027-01-01T00:00:00Z',
        0, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z'
      )
    `);

    expect(() => insertStmt.run()).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it('prevents deleting a case from silently destroying attached evidence (RESTRICT)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedDemoData(db);

    const validCaseId = 'case_apex_2026_001';

    // Insert valid evidence
    db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename,
        safe_display_name, mime_type, detected_mime_type, byte_size,
        sha256, storage_key, status, sensitivity, source_url,
        captured_at, uploaded_at, uploaded_by, retention_until,
        legal_hold, created_at, updated_at
      ) VALUES (
        'ev_attached', 'org_apex_health_01', ?, 'image', 'photo.png',
        'photo.png', 'image/png', 'image/png', 500,
        'hash123', 'key123', 'available', 'normal', NULL,
        '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'usr_apex_mgr_02', '2027-01-01T00:00:00Z',
        0, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z'
      )
    `).run(validCaseId);

    // Attempt to delete the case -> MUST FAIL because of ON DELETE RESTRICT
    expect(() => {
      db.prepare('DELETE FROM cases WHERE id = ?').run(validCaseId);
    }).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it('enforces legal-hold relationship foreign keys', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedDemoData(db);

    // Attempt to insert hold for non-existent evidence
    expect(() => {
      db.prepare(`
        INSERT INTO evidence_retention_holds (
          id, organization_id, evidence_id, created_by, reason, created_at
        ) VALUES (
          'hold_bad', 'org_apex_health_01', 'ev_non_existent', 'usr_apex_mgr_02', 'Test reason', '2026-09-12T00:00:00Z'
        )
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });
});
