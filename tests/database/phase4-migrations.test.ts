import { describe, it, expect } from 'vitest';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 4 Migrations (0005_phase4_grievance_operations.sql)', () => {
  it('applies all migrations successfully on a pristine in-memory database', () => {
    const db = createDatabaseConnection({ inMemory: true });
    try {
      runMigrations(db);

      // Verify new tables exist
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('platform_registry');
      expect(tableNames).toContain('platform_policy_versions');
      expect(tableNames).toContain('platform_playbooks');
      expect(tableNames).toContain('submissions');
      expect(tableNames).toContain('submission_transitions');
      expect(tableNames).toContain('submission_approvals');
      expect(tableNames).toContain('submission_responses');
      expect(tableNames).toContain('case_escalations');
      expect(tableNames).toContain('related_content_observations');

      // Verify columns on statutory_clocks
      const clockCols = db.prepare('PRAGMA table_info(statutory_clocks)').all() as Array<{ name: string }>;
      const colNames = clockCols.map((c) => c.name);
      expect(colNames).toContain('operational_rule');
      expect(colNames).toContain('jurisdiction');
      expect(colNames).toContain('source_citation');
      expect(colNames).toContain('source_url_or_identifier');
      expect(colNames).toContain('effective_date');
      expect(colNames).toContain('last_verified_date');
      expect(colNames).toContain('deadline_type');
    } finally {
      db.close();
    }
  });

  it('verifies platform registry has default seeded records', () => {
    const db = createDatabaseConnection({ inMemory: true });
    try {
      runMigrations(db);

      const count = db.prepare('SELECT COUNT(*) as count FROM platform_registry').get() as { count: number };
      expect(count.count).toBeGreaterThanOrEqual(7);

      const pbCount = db.prepare('SELECT COUNT(*) as count FROM platform_playbooks').get() as { count: number };
      expect(pbCount.count).toBe(9);
    } finally {
      db.close();
    }
  });

  it('enforces foreign key RESTRICT on submissions deletion', () => {
    const db = createDatabaseConnection({ inMemory: true });
    try {
      runMigrations(db);

      // Enable foreign keys
      db.pragma('foreign_keys = ON');

      // Create test org and user
      db.prepare("INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email) VALUES ('org_test', 'Test Org', 'test-org', 'Tech', 'IN-DL', 'test@example.com')").run();
      db.prepare("INSERT INTO users (id, email, full_name, password_hash) VALUES ('usr_test', 'user@example.com', 'Test User', 'hash')").run();
      db.prepare("INSERT INTO cases (id, organization_id, case_number, title, category, priority, status, target_entity, contested_url, hosting_platform, reported_by_email) VALUES ('cas_test', 'org_test', 'CAS-001', 'Test', 'fake_social_profile', 'medium', 'new', 'Target', 'https://example.com/target', 'instagram', 'rep@example.com')").run();

      // Create submission
      db.prepare(`
        INSERT INTO submissions (
          id, case_id, organization_id, platform_id, playbook_id, status,
          packet_version, packet_hash, packet_payload_json, packet_markdown, created_by
        ) VALUES (
          'sub_test', 'cas_test', 'org_test', 'plt_instagram', 'pb_fake_profile', 'draft',
          1, 'fake_hash', '{}', 'markdown', 'usr_test'
        )
      `).run();

      // Attempting to delete case should fail with foreign key constraint
      expect(() => {
        db.prepare("DELETE FROM cases WHERE id = 'cas_test'").run();
      }).toThrowError(/FOREIGN KEY constraint failed/i);
    } finally {
      db.close();
    }
  });
});
