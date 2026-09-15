import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 6 Migration Verification (0007_phase6_monitoring_detection.sql)', () => {
  let db: any;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('adds monitoring quota columns to pilot_entitlements table', () => {
    const cols = db.prepare(`PRAGMA table_info(pilot_entitlements)`).all() as any[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('max_monitored_subjects');
    expect(colNames).toContain('max_monthly_monitoring_signals');
  });

  it('creates all Phase 6 monitoring and candidate correlation tables', () => {
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as any[]).map((t) => t.name);

    expect(tables).toContain('monitored_subjects');
    expect(tables).toContain('monitoring_policies');
    expect(tables).toContain('monitoring_signals');
    expect(tables).toContain('candidate_correlations');
    expect(tables).toContain('candidate_risk_scores');
    expect(tables).toContain('candidate_reviews');
    expect(tables).toContain('signal_case_links');
    expect(tables).toContain('monitoring_adapters');
  });

  it('seeds safe read-only monitoring adapters', () => {
    const adapters = db.prepare(`SELECT * FROM monitoring_adapters`).all() as any[];
    expect(adapters.length).toBeGreaterThanOrEqual(4);

    const names = adapters.map((a) => a.name);
    expect(names).toContain('manual_intake');
    expect(names).toContain('file_replay');
    expect(names).toContain('inbound_webhook');
    expect(names).toContain('local_fixture');

    // All seeded adapters must be safe read-only
    for (const adp of adapters) {
      expect(adp.is_safe_read_only).toBe(1);
    }
  });

  it('enforces unique constraint on monitoring_signals idempotency_key', () => {
    // Seed prerequisite organization and user
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_mon_test', 'Mon Org', 'mon-org', 'Legal', 'IN-DL', 'mon@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name)
      VALUES ('usr_mon_01', 'analyst@mon.org', 'hash', 'Analyst One')
    `).run();

    // Create subject
    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, aliases, handles,
        monitoring_status, authorization_basis, authorization_reference, created_by_user_id
      ) VALUES (
        'sbj_01', 'org_mon_test', 'individual', 'Dr. Ramesh Sharma', '["Dr Sharma"]', '["@drsharma"]',
        'active', 'direct_mandate', 'REF-2026-001', 'usr_mon_01'
      )
    `).run();

    // Insert initial signal
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_hash,
        metadata_hash, idempotency_key
      ) VALUES (
        'sig_01', 'org_mon_test', 'sbj_01', 'manual_intake', 'manual_input',
        'https://instagram.com/fake_drsharma?utm_source=test', 'https://instagram.com/fake_drsharma',
        'instagram', '2026-09-13T10:00:00Z', 'hash_c_1', 'hash_m_1', 'idem_key_001'
      )
    `).run();

    // Duplicate idempotency_key must throw
    expect(() => {
      db.prepare(`
        INSERT INTO monitoring_signals (
          id, organization_id, subject_id, adapter_name, source_type,
          observed_url, normalized_url, platform, observed_at, content_hash,
          metadata_hash, idempotency_key
        ) VALUES (
          'sig_02', 'org_mon_test', 'sbj_01', 'manual_intake', 'manual_input',
          'https://instagram.com/fake_drsharma?utm_source=test2', 'https://instagram.com/fake_drsharma',
          'instagram', '2026-09-13T10:00:00Z', 'hash_c_2', 'hash_m_2', 'idem_key_001'
        )
      `).run();
    }).toThrow();
  });

  it('enforces composite uniqueness on signal_case_links', () => {
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_link_test', 'Link Org', 'link-org', 'Legal', 'IN-DL', 'link@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name)
      VALUES ('usr_lnk_01', 'analyst@link.org', 'hash', 'Analyst Lnk')
    `).run();

    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, aliases, handles,
        monitoring_status, authorization_basis, authorization_reference, created_by_user_id
      ) VALUES (
        'sbj_lnk', 'org_link_test', 'individual', 'Subject Lnk', '[]', '[]',
        'active', 'direct_mandate', 'REF-2026-002', 'usr_lnk_01'
      )
    `).run();

    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_hash,
        metadata_hash, idempotency_key
      ) VALUES (
        'sig_lnk_01', 'org_link_test', 'sbj_lnk', 'manual_intake', 'manual_input',
        'https://example.com/target', 'https://example.com/target',
        'other', '2026-09-13T10:00:00Z', 'h1', 'h2', 'idem_lnk_1'
      )
    `).run();

    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority,
        status, target_entity, contested_url, hosting_platform, reported_by_email
      ) VALUES (
        'case_lnk_01', 'org_link_test', 'CASE-2026-001', 'Test Impersonation Case',
        'fake_social_profile', 'medium', 'new', 'Subject Lnk', 'https://example.com/target',
        'other', 'analyst@link.org'
      )
    `).run();

    // Link signal to case
    db.prepare(`
      INSERT INTO signal_case_links (id, signal_id, case_id, link_type, linked_by_user_id)
      VALUES ('lnk_01', 'sig_lnk_01', 'case_lnk_01', 'evidence', 'usr_lnk_01')
    `).run();

    // Duplicate link must fail
    expect(() => {
      db.prepare(`
        INSERT INTO signal_case_links (id, signal_id, case_id, link_type, linked_by_user_id)
        VALUES ('lnk_02', 'sig_lnk_01', 'case_lnk_01', 'repeat_infringement', 'usr_lnk_01')
      `).run();
    }).toThrow();
  });
});
