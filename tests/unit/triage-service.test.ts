import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { TriageService } from '../../src/services/triage-service.js';

describe('Phase 3 Unit Test: Triage Service', () => {
  let db: Database.Database;
  let triageService: TriageService;
  const orgId = 'org_triage_test';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Triage Org', 'triage-org', 'Legal', 'IN-DL', 'triage@example.com')
    `).run(orgId);

    triageService = new TriageService(db);
  });

  it('classifies non-consensual intimate imagery under Rule 3(2)(b) with 24h urgency', () => {
    const evalResult = triageService.evaluate({
      title: 'Compromised Private Media',
      category: 'privacy_or_likeness_complaint',
      involves_intimate_imagery: 1,
      target_entity: 'Dr. Anita Sharma',
      hosting_platform: 'Telegram'
    });

    expect(evalResult.classification).toBe('non_consensual_intimate_imagery');
    expect(evalResult.confidence).toBe('high');
    expect(evalResult.triggeredRules).toContain('INTIMATE_IMAGERY_RULE_3_2_B');
    expect(evalResult.triggeredRules).toContain('STATUTORY_EXPEDITED_24H');
    expect(evalResult.requiresHumanReview).toBe(true);
    expect(evalResult.requiresLegalReview).toBe(true);
  });

  it('classifies defamation with mandatory legal review and substantiation rule', () => {
    const evalResult = triageService.evaluate({
      title: 'False Accusations Online',
      category: 'defamation_legal_escalation',
      factual_basis: 'Extensive false accusations regarding clinical misconduct published on social media.',
      target_entity: 'Apex Healthcare',
      hosting_platform: 'X / Twitter'
    });

    expect(evalResult.classification).toBe('defamation_or_legal_escalation');
    expect(evalResult.triggeredRules).toContain('DEFAMATION_SUBSTANTIATION_REQUIRED');
    expect(evalResult.triggeredRules).toContain('MANDATORY_LEGAL_REVIEW');
    expect(evalResult.requiresLegalReview).toBe(true);
  });

  it('classifies high-risk synthetic media deepfake impersonation', () => {
    const evalResult = triageService.evaluate({
      title: 'Lip Sync Deepfake Scam',
      category: 'synthetic_media_endorsement',
      suspected_synthetic_media_type: 'lip_sync_deepfake',
      harm_type: 'financial_fraud',
      target_entity: 'Leading Oncologist',
      hosting_platform: 'Instagram'
    });

    expect(evalResult.classification).toBe('synthetic_media_impersonation');
    expect(evalResult.triggeredRules).toContain('SYNTHETIC_MEDIA_DEEPFAKE_FLAG');
    expect(evalResult.triggeredRules).toContain('HIGH_RISK_LIPSYNC_FACESWAP');
    expect(evalResult.requiresLegalReview).toBe(true);
  });

  it('classifies financial fraud as commercial misuse under BNS 318(4)', () => {
    const evalResult = triageService.evaluate({
      title: 'Crypto Investment Scam Account',
      category: 'fake_support_account',
      harm_type: 'financial_fraud',
      target_entity: 'Fintech Bank',
      hosting_platform: 'Telegram'
    });

    expect(evalResult.classification).toBe('fake_endorsement_or_commercial_misuse');
    expect(evalResult.triggeredRules).toContain('FINANCIAL_FRAUD_HARMFUL_ACTIVITY');
    expect(evalResult.triggeredRules).toContain('BNS_318_4_CHEATING_BY_PERSONATION');
  });

  it('classifies standard profile impersonation under IT Rules 2021 Rule 3(1)(b)', () => {
    const evalResult = triageService.evaluate({
      title: 'Fake Instagram Bio',
      category: 'fake_social_profile',
      harm_type: 'reputational',
      target_entity: 'Celebrity Chef',
      hosting_platform: 'Instagram'
    });

    expect(evalResult.classification).toBe('standard_impersonation');
    expect(evalResult.triggeredRules).toContain('STANDARD_IMPERSONATION_RULE_3_1_B');
    expect(evalResult.requiresLegalReview).toBe(false);
  });

  it('records and retrieves triage records from database', () => {
    const caseId = 'case_triage_test_1';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-901', 'Test Triage Case', 'brand_impersonation', 'medium', 'new',
        'Test Brand', 'https://example.com/fake', 'Instagram', 'reporter@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);

    const record = triageService.recordTriage(
      caseId,
      orgId,
      'actor_analyst_1',
      {
        category: 'brand_impersonation',
        harm_type: 'trademark_infringement'
      },
      'Operator confirmed brand logo copy'
    );

    expect(record.id).toBeDefined();
    expect(record.classification).toBe('copyright_or_trademark_complaint');

    const fetched = triageService.getLatestTriage(caseId, orgId);
    expect(fetched).not.toBeNull();
    expect(fetched?.classification).toBe('copyright_or_trademark_complaint');
    expect(fetched?.notes).toContain('Operator confirmed brand logo copy');
  });
});
