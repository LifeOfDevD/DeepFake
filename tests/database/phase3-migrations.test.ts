import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 3 Schema and Foreign Key Integrity', () => {
  let db: Database.Database;
  const orgId = 'org_schema_test';
  const caseId = 'case_schema_test';
  const userId = 'user_schema_test';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Schema Org', 'schema-org', 'Legal', 'IN-DL', 'schema@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role)
      VALUES (?, 'user@example.com', 'Schema User', 'hash', 'user')
    `).run(userId);

    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis,
        created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-001', 'Schema Test Case', 'brand_impersonation', 'medium', 'new',
        'Target', 'https://example.com', 'Web', 'user@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);
  });

  it('prevents cascading deletion of cases referenced by case_triage_records', () => {
    db.prepare(`
      INSERT INTO case_triage_records (
        id, case_id, organization_id, classification, confidence,
        triggered_rules, actor_or_component, requires_human_review
      ) VALUES ('triage_1', ?, ?, 'standard_impersonation', 'high', '[]', 'tester', 1)
    `).run(caseId, orgId);

    expect(() => {
      db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('prevents cascading deletion of cases referenced by statutory_clocks', () => {
    db.prepare(`
      INSERT INTO statutory_clocks (
        id, case_id, organization_id, incident_discovered_at, complaint_created_at,
        acknowledgement_deadline, submission_deadline, escalation_deadline,
        operational_basis, timezone
      ) VALUES (
        'clock_1', ?, ?, datetime('now'), datetime('now'),
        datetime('now', '+24 hours'), datetime('now', '+72 hours'), datetime('now', '+15 days'),
        'IT Rules', 'Asia/Kolkata'
      )
    `).run(caseId, orgId);

    expect(() => {
      db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('prevents cascading deletion of cases referenced by submission_packets', () => {
    db.prepare(`
      INSERT INTO submission_packets (
        id, case_id, organization_id, packet_version, status,
        packet_hash, packet_json, packet_markdown, evidence_manifest_json,
        generated_by
      ) VALUES (
        'packet_1', ?, ?, 1, 'dry_run_generated',
        'hash123', '{}', '# Notice', '[]', ?
      )
    `).run(caseId, orgId, userId);

    expect(() => {
      db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('prevents cascading deletion of cases referenced by duplicate_case_links', () => {
    const secondCaseId = 'case_schema_second';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis,
        created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-002', 'Second Case', 'brand_impersonation', 'medium', 'new',
        'Target', 'https://example.com/2', 'Web', 'user@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(secondCaseId, orgId);

    db.prepare(`
      INSERT INTO duplicate_case_links (
        id, organization_id, source_case_id, matched_case_id,
        match_reason, similarity_score, status
      ) VALUES (
        'dupe_1', ?, ?, ?, 'Same URL', 1.0, 'pending_review'
      )
    `).run(orgId, caseId, secondCaseId);

    expect(() => {
      db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('verifies all Phase 3 indexes exist in database schema', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    const indexNames = new Set(indexes.map((i) => i.name));

    expect(indexNames.has('idx_cases_approval_status')).toBe(true);
    expect(indexNames.has('idx_cases_normalized_url')).toBe(true);
    expect(indexNames.has('idx_triage_case')).toBe(true);
    expect(indexNames.has('idx_clock_case')).toBe(true);
    expect(indexNames.has('idx_clock_status')).toBe(true);
    expect(indexNames.has('idx_readiness_case')).toBe(true);
    expect(indexNames.has('idx_packets_case')).toBe(true);
    expect(indexNames.has('idx_approval_case')).toBe(true);
    expect(indexNames.has('idx_tasks_org_status')).toBe(true);
    expect(indexNames.has('idx_tasks_case')).toBe(true);
    expect(indexNames.has('idx_duplicates_source')).toBe(true);
  });
});
