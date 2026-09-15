import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SuppressionService } from '../../src/services/evaluation/suppression-service.js';
import { MonitoringSignal } from '../../src/domain/types.js';

describe('Unit: SuppressionService', () => {
  let db: any;
  let service: SuppressionService;
  const orgId = 'org_suppress_test';
  const userId = 'user_analyst_01';

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Suppression Test Org', 'suppression-test-org', 'technology', 'IN-DL', 'test@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role, is_active)
      VALUES (?, 'analyst@example.com', 'Analyst', 'hash', 'analyst', 1)
    `).run(userId);

    service = new SuppressionService(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates active tenant-scoped suppression rule with mandatory expiration date', () => {
    const rule = service.createSuppressionRule(orgId, userId, {
      name: 'Suppress Known Satire Feed',
      rule_type: 'parody_satire',
      pattern: 'satire_brand_news',
      pattern_type: 'handle',
      justification: 'Official recognized satire page that is not misleading consumers.',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });

    expect(rule.id).toMatch(/^sup_/);
    expect(rule.organization_id).toBe(orgId);
    expect(rule.is_active).toBe(1);
    expect(rule.override_count).toBe(0);
    expect(rule.expires_at).toBeDefined();

    const rules = service.listSuppressionRules(orgId);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(rule.id);
  });

  it('suppresses matching signals for domain glob, exact URL, and keyword rules', () => {
    // 1. Create domain glob rule
    service.createSuppressionRule(orgId, userId, {
      name: 'Affiliate Blog',
      rule_type: 'authorized_partner',
      pattern: '*.authorized-reviews.example',
      pattern_type: 'domain_glob',
      justification: 'Verified affiliate blog network',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });

    // 2. Create exact URL rule
    service.createSuppressionRule(orgId, userId, {
      name: 'Legacy Press Release',
      rule_type: 'news_reporting',
      pattern: 'https://news.example/press/2024-announcement',
      pattern_type: 'exact_url',
      justification: 'Static press archive',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });

    // Test domain glob match
    const dummySignal1 = {
      id: 'sig_1',
      normalized_url: 'https://tech.authorized-reviews.example/article-1',
      raw_payload: { content: 'Honest review of the product' }
    } as any as MonitoringSignal;

    const res1 = service.evaluateSignalSuppression(orgId, dummySignal1);
    expect(res1.isSuppressed).toBe(true);
    expect(res1.matchedRule?.pattern_type).toBe('domain_glob');

    // Test exact URL match
    const dummySignal2 = {
      id: 'sig_2',
      normalized_url: 'https://news.example/press/2024-announcement',
      raw_payload: { content: 'Corporate statement' }
    } as any as MonitoringSignal;

    const res2 = service.evaluateSignalSuppression(orgId, dummySignal2);
    expect(res2.isSuppressed).toBe(true);
    expect(res2.matchedRule?.pattern_type).toBe('exact_url');

    // Test non-matching URL
    const dummySignal3 = {
      id: 'sig_3',
      normalized_url: 'https://scam-lookalike.example/login',
      raw_payload: { content: 'Phishing login page' }
    } as any as MonitoringSignal;

    const res3 = service.evaluateSignalSuppression(orgId, dummySignal3);
    expect(res3.isSuppressed).toBe(false);
    expect(res3.matchedRule).toBeUndefined();
  });

  it('ignores expired suppression rules', () => {
    const rule = service.createSuppressionRule(orgId, userId, {
      name: 'Expired Rule',
      rule_type: 'authorized_partner',
      pattern: 'temporary_promo_account',
      pattern_type: 'handle',
      justification: 'Temporary promo expired',
      expires_in_days: 1,
      ruleset_version: 'v1.0'
    });

    // Manually backdate expiration in DB to simulate expired rule
    db.prepare(`
      UPDATE suppression_rules
      SET expires_at = datetime('now', '-2 days')
      WHERE id = ?
    `).run(rule.id);

    const dummySignal = {
      id: 'sig_expired',
      normalized_url: 'https://instagram.com/temporary_promo_account',
      raw_payload: { handle: 'temporary_promo_account' }
    } as any as MonitoringSignal;

    const result = service.evaluateSignalSuppression(orgId, dummySignal);
    expect(result.isSuppressed).toBe(false);
  });

  it('FAIL-CLOSED SAFETY: unconditionally bypasses suppression for critical sensitivity subjects and scam keywords', () => {
    // Broad rule that would otherwise match
    service.createSuppressionRule(orgId, userId, {
      name: 'Broad Catch',
      rule_type: 'parody_satire',
      pattern: 'doctor',
      pattern_type: 'keyword',
      justification: 'Suppress generic doctor mentions',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });

    // 1. Critical Sensitivity subject must bypass suppression even if pattern matches!
    const criticalSignal = {
      id: 'sig_crit',
      normalized_url: 'https://social.example/dr_impersonator',
      raw_payload: { content: 'Consultation with doctor today' }
    } as any as MonitoringSignal;

    const criticalResult = service.evaluateSignalSuppression(orgId, criticalSignal, 'critical');
    expect(criticalResult.isSuppressed).toBe(false);
    expect(criticalResult.reason).toContain('CRITICAL_SENSITIVITY_FAIL_CLOSED');

    // 2. Severe scam keywords must bypass suppression unconditionally
    const scamSignal = {
      id: 'sig_scam',
      normalized_url: 'https://social.example/crypto_giveaway_dr',
      raw_payload: { content: 'Doctor endorsing 500% crypto giveaway urgent wire transfer now' }
    } as any as MonitoringSignal;

    const scamResult = service.evaluateSignalSuppression(orgId, scamSignal, 'normal');
    expect(scamResult.isSuppressed).toBe(false);
    expect(scamResult.reason).toContain('SEVERE_SCAM_FAIL_CLOSED');
  });

  it('records human override increments for suppression rules', () => {
    const rule = service.createSuppressionRule(orgId, userId, {
      name: 'Override Test Rule',
      rule_type: 'authorized_partner',
      pattern: 'test_partner',
      pattern_type: 'handle',
      justification: 'Test partner account',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });

    expect(rule.override_count).toBe(0);

    service.recordHumanOverride(rule.id);
    service.recordHumanOverride(rule.id);

    const updated = service.getSuppressionRuleById(rule.id, orgId);
    expect(updated!.override_count).toBe(2);
  });
});
