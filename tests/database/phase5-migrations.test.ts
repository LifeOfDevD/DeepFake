import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 5 Migration Verification (0006_phase5_pilot_saas.sql)', () => {
  let db: any;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('adds status, deactivation, and onboarding columns to organizations table', () => {
    const orgCols = db.prepare(`PRAGMA table_info(organizations)`).all() as any[];
    const colNames = orgCols.map((c) => c.name);

    expect(colNames).toContain('status');
    expect(colNames).toContain('deactivated_at');
    expect(colNames).toContain('deactivation_reason');
    expect(colNames).toContain('timezone');
    expect(colNames).toContain('onboarding_checklist');
  });

  it('adds status and suspension columns to users table', () => {
    const userCols = db.prepare(`PRAGMA table_info(users)`).all() as any[];
    const colNames = userCols.map((c) => c.name);

    expect(colNames).toContain('status');
    expect(colNames).toContain('suspended_at');
    expect(colNames).toContain('suspension_reason');
  });

  it('creates all Phase 5 pilot and SaaS operational tables', () => {
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as any[]).map((t) => t.name);

    expect(tables).toContain('organization_invitations');
    expect(tables).toContain('pilot_entitlements');
    expect(tables).toContain('usage_events');
    expect(tables).toContain('usage_daily_aggregates');
    expect(tables).toContain('usage_adjustments');
    expect(tables).toContain('notification_outbox');
    expect(tables).toContain('in_app_notifications');
    expect(tables).toContain('worker_heartbeats');
  });

  it('verifies unique constraints on idempotency keys and hashes', () => {
    // organization_invitations token_hash unique
    const invIndexes = db.prepare(`PRAGMA index_list(organization_invitations)`).all() as any[];
    expect(invIndexes.length).toBeGreaterThan(0);

    // usage_events idempotency_key unique
    const usageIndexes = db.prepare(`PRAGMA index_list(usage_events)`).all() as any[];
    expect(usageIndexes.some((idx) => idx.unique === 1)).toBe(true);

    // notification_outbox idempotency_key unique
    const notifIndexes = db.prepare(`PRAGMA index_list(notification_outbox)`).all() as any[];
    expect(notifIndexes.some((idx) => idx.unique === 1)).toBe(true);
  });

  it('verifies composite unique constraint on usage_daily_aggregates', () => {
    // Insert prerequisite organization for foreign key
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_test', 'Test Org', 'test-org', 'Tech', 'IN-DL', 'test@example.com')
    `).run();

    // Insert initial row
    db.prepare(`
      INSERT INTO usage_daily_aggregates (id, organization_id, event_type, date, total_quantity, updated_at)
      VALUES ('agg_01', 'org_test', 'case_created', '2026-09-12', 5, datetime('now'))
    `).run();

    // Duplicate (org, event_type, date) must fail constraint
    expect(() => {
      db.prepare(`
        INSERT INTO usage_daily_aggregates (id, organization_id, event_type, date, total_quantity, updated_at)
        VALUES ('agg_02', 'org_test', 'case_created', '2026-09-12', 10, datetime('now'))
      `).run();
    }).toThrow();
  });
});
