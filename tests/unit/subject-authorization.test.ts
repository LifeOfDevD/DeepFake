import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SubjectService } from '../../src/services/monitoring/subject-service.js';
import { SignalIngestionService } from '../../src/services/monitoring/signal-ingestion-service.js';

describe('Unit: Subject Authorization Mandate & Signal Ingestion Safety', () => {
  let db: any;
  let subjectService: SubjectService;
  let signalService: SignalIngestionService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);
    subjectService = new SubjectService(db);
    signalService = new SignalIngestionService(db);

    // Seed test org and user
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_auth_test', 'Auth Org', 'auth-org', 'Legal', 'IN-DL', 'auth@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name)
      VALUES ('usr_auth_01', 'analyst@auth.org', 'hash', 'Analyst Auth')
    `).run();

    // Default entitlement: max 2 subjects for test quota verification
    db.prepare(`
      INSERT INTO pilot_entitlements (
        id, organization_id, plan_tier, pilot_start_date, pilot_end_date,
        max_monitored_subjects, max_monthly_monitoring_signals
      ) VALUES (
        'ent_auth_01', 'org_auth_test', 'pilot', '2026-09-01', '2026-12-01', 2, 10
      )
    `).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates subject with lawful mandate and verifies active authorization', () => {
    const subject = subjectService.createSubject('org_auth_test', 'usr_auth_01', {
      subject_type: 'executive',
      canonical_name: 'Ananya Roy',
      aliases: ['AR'],
      handles: ['@ananya_roy'],
      official_domains: ['ananyaroy.com'],
      official_social_urls: ['https://linkedin.com/in/ananyaroy'],
      authorization_basis: 'representation_agreement',
      authorization_reference: 'AGR-2026-AR-001',
      monitoring_status: 'draft',
      sensitivity: 'high',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    expect(subject.id).toBeDefined();
    expect(subject.canonical_name).toBe('Ananya Roy');

    // While in draft, authorization verification must fail
    const authDraft = subjectService.verifySubjectAuthorization('org_auth_test', subject.id);
    expect(authDraft.authorized).toBe(false);
    expect(authDraft.reason).toContain('must be \'active\'');

    // Activate subject
    const activated = subjectService.updateSubject('org_auth_test', subject.id, 'usr_auth_01', {
      monitoring_status: 'active'
    });
    expect(activated.monitoring_status).toBe('active');

    // Now authorization must succeed
    const authActive = subjectService.verifySubjectAuthorization('org_auth_test', subject.id);
    expect(authActive.authorized).toBe(true);
  });

  it('rejects subject creation when authorization basis is missing', () => {
    expect(() => {
      subjectService.createSubject('org_auth_test', 'usr_auth_01', {
        subject_type: 'individual',
        canonical_name: 'Unverified Entity',
        aliases: [],
        handles: [],
        official_domains: [],
        official_social_urls: [],
        authorization_basis: '' as any,
        authorization_reference: '',
        monitoring_status: 'draft',
        sensitivity: 'low',
        retention_policy_days: 90,
        reference_images_metadata: [],
        reference_audio_metadata: [],
        voice_enrollment_status: 'not_enrolled',
        face_enrollment_status: 'not_enrolled',
        jurisdiction: 'IN'
      });
    }).toThrow(/AUTHORIZATION_REQUIRED/);
  });

  it('enforces pilot quota on maximum monitored subjects', () => {
    // 1st subject
    subjectService.createSubject('org_auth_test', 'usr_auth_01', {
      subject_type: 'individual',
      canonical_name: 'Subject One',
      aliases: [],
      handles: [],
      official_domains: [],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'REF-001',
      monitoring_status: 'active',
      sensitivity: 'medium',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    // 2nd subject
    subjectService.createSubject('org_auth_test', 'usr_auth_01', {
      subject_type: 'individual',
      canonical_name: 'Subject Two',
      aliases: [],
      handles: [],
      official_domains: [],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'REF-002',
      monitoring_status: 'active',
      sensitivity: 'medium',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    // 3rd subject exceeds quota (limit is 2)
    expect(() => {
      subjectService.createSubject('org_auth_test', 'usr_auth_01', {
        subject_type: 'individual',
        canonical_name: 'Subject Three',
        aliases: [],
        handles: [],
        official_domains: [],
        official_social_urls: [],
        authorization_basis: 'direct_mandate',
        authorization_reference: 'REF-003',
        monitoring_status: 'active',
        sensitivity: 'medium',
        retention_policy_days: 90,
        reference_images_metadata: [],
        reference_audio_metadata: [],
        voice_enrollment_status: 'not_enrolled',
        face_enrollment_status: 'not_enrolled',
        jurisdiction: 'IN'
      });
    }).toThrow(/QUOTA_EXCEEDED/);
  });

  it('SignalIngestionService blocks ingestion if subject is inactive or unauthorized', () => {
    // Subject in draft
    const subject = subjectService.createSubject('org_auth_test', 'usr_auth_01', {
      subject_type: 'creator',
      canonical_name: 'Draft Creator',
      aliases: [],
      handles: [],
      official_domains: [],
      official_social_urls: [],
      authorization_basis: 'power_of_attorney',
      authorization_reference: 'POA-100',
      monitoring_status: 'draft',
      sensitivity: 'medium',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    // Ingestion must be blocked with SUBJECT_UNAUTHORIZED
    expect(() => {
      signalService.ingestSignal('org_auth_test', 'usr_auth_01', {
        subject_id: subject.id,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/fake_creator',
        platform: 'instagram'
      });
    }).toThrow(/SUBJECT_UNAUTHORIZED/);
  });

  it('SignalIngestionService deduplicates identical signals idempotently', () => {
    const subject = subjectService.createSubject('org_auth_test', 'usr_auth_01', {
      subject_type: 'brand',
      canonical_name: 'Apex Brand',
      aliases: [],
      handles: [],
      official_domains: [],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'MANDATE-BRAND-01',
      monitoring_status: 'active',
      sensitivity: 'high',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    const res1 = signalService.ingestSignal('org_auth_test', 'usr_auth_01', {
      subject_id: subject.id,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://facebook.com/fake_apex?utm_source=ad',
      platform: 'facebook'
    });
    expect(res1.isDuplicate).toBe(false);
    expect(res1.signal.id).toBeDefined();

    // Ingesting the same normalized URL on the same day for same subject
    const res2 = signalService.ingestSignal('org_auth_test', 'usr_auth_01', {
      subject_id: subject.id,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://facebook.com/fake_apex/?fbclid=track',
      platform: 'facebook'
    });
    expect(res2.isDuplicate).toBe(true);
    expect(res2.signal.id).toBe(res1.signal.id);
  });
});
