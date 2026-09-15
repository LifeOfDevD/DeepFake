import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { CandidateCorrelationService } from '../../src/services/monitoring/correlation-service.js';
import { MonitoredSubject, MonitoringSignal } from '../../src/domain/types.js';

describe('Unit: CandidateCorrelationService', () => {
  let db: any;
  let correlationService: CandidateCorrelationService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);
    correlationService = new CandidateCorrelationService(db);

    // Seed test org, user, and subject
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_cor_test', 'Cor Org', 'cor-org', 'Legal', 'IN-DL', 'cor@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name)
      VALUES ('usr_cor_01', 'analyst@cor.org', 'hash', 'Analyst Cor')
    `).run();

    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, aliases, handles,
        official_domains, official_social_urls, monitoring_status, authorization_basis,
        authorization_reference, sensitivity, created_by_user_id
      ) VALUES (
        'sbj_cor_01', 'org_cor_test', 'doctor', 'Dr. Ramesh Sharma',
        '["Dr Sharma", "Ramesh Sharma"]', '["@dr_sharma_real"]',
        '["drsharma.org"]', '["https://instagram.com/dr_sharma_real"]',
        'active', 'direct_mandate', 'REF-2026-99', 'critical', 'usr_cor_01'
      )
    `).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  const baseSubject: MonitoredSubject = {
    id: 'sbj_cor_01',
    organization_id: 'org_cor_test',
    subject_type: 'doctor',
    canonical_name: 'Dr. Ramesh Sharma',
    aliases: ['Dr Sharma', 'Ramesh Sharma'],
    handles: ['@dr_sharma_real'],
    official_domains: ['drsharma.org'],
    official_social_urls: ['https://instagram.com/dr_sharma_real'],
    reference_images_metadata: [],
    reference_audio_metadata: [],
    voice_enrollment_status: 'not_enrolled',
    face_enrollment_status: 'not_enrolled',
    monitoring_status: 'active',
    authorization_basis: 'direct_mandate',
    authorization_reference: 'REF-2026-99',
    jurisdiction: 'IN',
    sensitivity: 'critical',
    retention_policy_days: 90,
    created_by_user_id: 'usr_cor_01',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  it('correlates high-risk impersonation candidate with handle match and medical fraud keywords', () => {
    // Insert signal in DB
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_hash,
        metadata_hash, idempotency_key
      ) VALUES (
        'sig_fraud_01', 'org_cor_test', 'sbj_cor_01', 'manual_intake', 'manual_input',
        'https://instagram.com/dr_sharma_real_cures/?utm_source=ad',
        'https://instagram.com/dr_sharma_real_cures',
        'instagram', '2026-09-13T10:00:00Z', 'hash_c', 'hash_m', 'idem_cor_1'
      )
    `).run();

    const signal: MonitoringSignal = {
      id: 'sig_fraud_01',
      organization_id: 'org_cor_test',
      subject_id: 'sbj_cor_01',
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://instagram.com/dr_sharma_real_cures/?utm_source=ad',
      normalized_url: 'https://instagram.com/dr_sharma_real_cures',
      platform: 'instagram',
      observed_at: '2026-09-13T10:00:00Z',
      content_type: 'profile',
      content_hash: 'hash_c',
      metadata_hash: 'hash_m',
      provenance: {},
      idempotency_key: 'idem_cor_1',
      processing_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_payload: JSON.stringify({
        bio: 'Official Dr. Ramesh Sharma miracles. DM for cures and secret herbal medicine.',
        handle: 'dr_sharma_real_cures'
      })
    };

    const result = correlationService.correlate(signal, baseSubject);

    expect(result.correlation.confidence_category).toBe('high');
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.correlation.matched_rules.length).toBeGreaterThan(0);
    expect(result.correlation.human_review_mandatory).toBe(1);
    expect(result.correlation.recommended_action).toBe('queue_for_review');

    // Verify DB updated
    const saved = correlationService.getCorrelationBySignalId('sig_fraud_01');
    expect(saved).not.toBeNull();
    expect(saved?.confidence_score).toBe(result.correlation.confidence_score);
  });

  it('marks candidate as authorized when URL matches official domains or profiles', () => {
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_hash,
        metadata_hash, idempotency_key
      ) VALUES (
        'sig_auth_01', 'org_cor_test', 'sbj_cor_01', 'manual_intake', 'manual_input',
        'https://drsharma.org/about-us', 'https://drsharma.org/about-us',
        'domain', '2026-09-13T10:00:00Z', 'hash_c2', 'hash_m2', 'idem_cor_2'
      )
    `).run();

    const signal: MonitoringSignal = {
      id: 'sig_auth_01',
      organization_id: 'org_cor_test',
      subject_id: 'sbj_cor_01',
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://drsharma.org/about-us',
      normalized_url: 'https://drsharma.org/about-us',
      platform: 'domain',
      observed_at: '2026-09-13T10:00:00Z',
      content_type: 'domain',
      content_hash: 'hash_c2',
      metadata_hash: 'hash_m2',
      provenance: {},
      idempotency_key: 'idem_cor_2',
      processing_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const result = correlationService.correlate(signal, baseSubject);

    expect(result.riskScore).toBe(0);
    expect(result.correlation.recommended_action).toBe('dismiss_false_positive');
    expect(result.correlation.false_positive_indicators).toContain('OFFICIAL_DOMAIN_OR_PROFILE_COLLISION');
  });

  it('detects parody indicators and applies discount while keeping human review mandatory', () => {
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_hash,
        metadata_hash, idempotency_key
      ) VALUES (
        'sig_parody_01', 'org_cor_test', 'sbj_cor_01', 'manual_intake', 'manual_input',
        'https://instagram.com/dr_sharma_parody', 'https://instagram.com/dr_sharma_parody',
        'instagram', '2026-09-13T10:00:00Z', 'hash_c3', 'hash_m3', 'idem_cor_3'
      )
    `).run();

    const signal: MonitoringSignal = {
      id: 'sig_parody_01',
      organization_id: 'org_cor_test',
      subject_id: 'sbj_cor_01',
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://instagram.com/dr_sharma_parody',
      normalized_url: 'https://instagram.com/dr_sharma_parody',
      platform: 'instagram',
      observed_at: '2026-09-13T10:00:00Z',
      content_type: 'profile',
      content_hash: 'hash_c3',
      metadata_hash: 'hash_m3',
      provenance: {},
      idempotency_key: 'idem_cor_3',
      processing_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw_payload: JSON.stringify({
        bio: 'Satire and meme fan page for Dr Sharma medical fans. Not affiliated.',
        handle: 'dr_sharma_parody'
      })
    };

    const result = correlationService.correlate(signal, baseSubject);

    expect(result.correlation.matched_rules).toContain('RULE_PARODY_SATIRE_DETECTED');
    expect(result.correlation.false_positive_indicators).toContain('EXPLICIT_PARODY_OR_FAN_INDICATOR');
    expect(result.correlation.human_review_mandatory).toBe(1);
  });
});
