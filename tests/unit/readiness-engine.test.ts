import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { ReadinessService } from '../../src/services/readiness-service.js';
import { Case } from '../../src/domain/types.js';

describe('Phase 3 Unit Test: 14-Point Readiness Engine', () => {
  let db: Database.Database;
  let readinessService: ReadinessService;
  const orgId = 'org_readiness_test';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Readiness Org', 'readiness-org', 'Legal', 'IN-DL', 'readiness@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role)
      VALUES ('user_1', 'user1@example.com', 'Test User 1', 'hash', 'user')
    `).run();

    readinessService = new ReadinessService(db);
  });

  function createSampleCase(overrides: Partial<Case> = {}): Case {
    const baseCase: Case = {
      id: 'case_ready_1',
      organization_id: orgId,
      case_number: 'CS-2026-801',
      title: 'Valid Medical Impersonation Title',
      category: 'founder_doctor_creator_impersonation',
      priority: 'high',
      status: 'human_review',
      target_entity: 'Dr. Rajiv Malhotra',
      contested_url: 'https://instagram.com/fake.dr.rajiv',
      hosting_platform: 'Instagram',
      reported_by_email: 'compliance@clinic.org',
      assigned_to_user_id: null,
      requires_legal_review: 0,
      statutory_basis: JSON.stringify(['IT Act Section 66D', 'IT Rules 2021 Rule 3(1)(b)']),
      selected_legal_grounds: JSON.stringify(['Section 318(4) BNS Impersonation']),
      declaration_confirmed: 1,
      harm_type: 'reputational',
      approval_status: 'triage_complete',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const caseData = { ...baseCase, ...overrides };

    db.prepare(`
      INSERT OR REPLACE INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis,
        selected_legal_grounds, declaration_confirmed, harm_type, approval_status,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      caseData.id,
      caseData.organization_id,
      caseData.case_number,
      caseData.title,
      caseData.category,
      caseData.priority,
      caseData.status,
      caseData.target_entity,
      caseData.contested_url,
      caseData.hosting_platform,
      caseData.reported_by_email,
      caseData.assigned_to_user_id,
      caseData.requires_legal_review,
      caseData.statutory_basis,
      caseData.selected_legal_grounds,
      caseData.declaration_confirmed,
      caseData.harm_type,
      caseData.approval_status,
      caseData.created_at,
      caseData.updated_at
    );

    return caseData;
  }

  function addEvidenceItem(caseId: string, status: string = 'available', isQuarantined: number = 0, hash?: string) {
    const sha = hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const sens = isQuarantined ? 'prohibited' : 'normal';
    db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename,
        safe_display_name, mime_type, detected_mime_type, byte_size, sha256,
        storage_key, status, sensitivity, uploaded_by, retention_until,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'image', 'proof.png',
        'proof.png', 'image/png', 'image/png', 1024, ?,
        'key_1', ?, ?, 'user_1', datetime('now', '+30 days'),
        datetime('now'), datetime('now')
      )
    `).run(`ev_${Math.random()}`, orgId, caseId, sha, status, sens);
  }

  it('fails readiness when no evidence is attached', () => {
    const c = createSampleCase();
    const result = readinessService.evaluate(c);

    expect(result.is_ready).toBe(false);
    expect(result.missing_requirements.some((m) => m.code === 'NO_PRESERVED_EVIDENCE')).toBe(true);
  });

  it('fails readiness when defamation claim lacks substantive factual basis narrative', () => {
    const c = createSampleCase({
      category: 'defamation_legal_escalation',
      requires_legal_review: 1,
      approval_status: 'legal_review_approved',
      factual_basis: 'Too short'
    });
    addEvidenceItem(c.id);

    const result = readinessService.evaluate(c);
    expect(result.is_ready).toBe(false);
    expect(result.missing_requirements.some((m) => m.code === 'DEFAMATION_BASIS_REQUIRED')).toBe(true);
  });

  it('fails readiness when legal review is required but not approved', () => {
    const c = createSampleCase({
      category: 'synthetic_media_endorsement',
      requires_legal_review: 1,
      approval_status: 'triage_complete' // Not legal_review_approved!
    });
    addEvidenceItem(c.id);

    const result = readinessService.evaluate(c);
    expect(result.is_ready).toBe(false);
    expect(result.missing_requirements.some((m) => m.code === 'LEGAL_REVIEW_PENDING')).toBe(true);
  });

  it('fails readiness when reporter declaration is unconfirmed', () => {
    const c = createSampleCase({ declaration_confirmed: 0 });
    addEvidenceItem(c.id);

    const result = readinessService.evaluate(c);
    expect(result.is_ready).toBe(false);
    expect(result.missing_requirements.some((m) => m.code === 'DECLARATION_NOT_CONFIRMED')).toBe(true);
  });

  it('fails readiness when evidence is quarantined', () => {
    const c = createSampleCase();
    addEvidenceItem(c.id, 'quarantined', 1);

    const result = readinessService.evaluate(c);
    expect(result.is_ready).toBe(false);
    expect(result.missing_requirements.some((m) => m.code === 'QUARANTINED_EVIDENCE_ATTACHED')).toBe(true);
  });

  it('passes all 14 checks when all requirements are fully satisfied', () => {
    const c = createSampleCase({
      requires_legal_review: 1,
      approval_status: 'legal_review_approved'
    });
    addEvidenceItem(c.id, 'available', 0);

    const result = readinessService.evaluate(c);
    expect(result.is_ready).toBe(true);
    expect(result.missing_requirements.length).toBe(0);
    expect(result.passed_checks).toContain('TITLE_PRESENT');
    expect(result.passed_checks).toContain('VALID_TARGET_URL');
    expect(result.passed_checks).toContain('HOSTING_PLATFORM_SPECIFIED');
    expect(result.passed_checks).toContain('TARGET_ENTITY_IDENTIFIED');
    expect(result.passed_checks).toContain('REPORTER_CONTACT_PRESENT');
    expect(result.passed_checks).toContain('CATEGORY_AND_HARM_MAPPED');
    expect(result.passed_checks).toContain('EVIDENCE_ATTACHED');
    expect(result.passed_checks).toContain('EVIDENCE_HASH_VERIFIED');
    expect(result.passed_checks).toContain('DEFAMATION_FACTUAL_BASIS');
    expect(result.passed_checks).toContain('COURT_ORDER_DETAILS');
    expect(result.passed_checks).toContain('LEGAL_REVIEW_APPROVED');
    expect(result.passed_checks).toContain('REPORTER_DECLARATION_CONFIRMED');
    expect(result.passed_checks).toContain('STATUTORY_GROUNDS_SPECIFIED');
    expect(result.passed_checks).toContain('NO_BLOCKING_EVIDENCE_HOLD_OR_QUARANTINE');
  });
});
