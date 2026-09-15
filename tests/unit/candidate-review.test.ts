import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { CandidateReviewService } from '../../src/services/monitoring/candidate-review-service.js';
import { SubjectService } from '../../src/services/monitoring/subject-service.js';
import { SignalIngestionService } from '../../src/services/monitoring/signal-ingestion-service.js';
import { CandidateCorrelationService } from '../../src/services/monitoring/correlation-service.js';

describe('Unit: CandidateReviewService', () => {
  let db: any;
  let reviewService: CandidateReviewService;
  let subjectService: SubjectService;
  let signalService: SignalIngestionService;
  let correlationService: CandidateCorrelationService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);

    reviewService = new CandidateReviewService(db);
    subjectService = new SubjectService(db);
    signalService = new SignalIngestionService(db);
    correlationService = new CandidateCorrelationService(db);

    // Seed organization & user
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_rev_test', 'Rev Org', 'rev-org', 'Legal', 'IN-DL', 'rev@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name)
      VALUES ('usr_rev_01', 'analyst@rev.org', 'hash', 'Analyst Rev')
    `).run();

    db.prepare(`
      INSERT INTO memberships (id, user_id, organization_id, role)
      VALUES ('mem_rev_01', 'usr_rev_01', 'org_rev_test', 'analyst')
    `).run();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('lists review queue with candidate correlation and score breakdown', () => {
    // 1. Create subject
    const subject = subjectService.createSubject('org_rev_test', 'usr_rev_01', {
      subject_type: 'individual',
      canonical_name: 'Dr. Vivek Mehra',
      aliases: ['Vivek Mehra'],
      handles: ['@dr_mehra'],
      official_domains: ['mehra.org'],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'MANDATE-VM-01',
      monitoring_status: 'active',
      sensitivity: 'high',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    // 2. Ingest signal
    const { signal } = signalService.ingestSignal('org_rev_test', 'usr_rev_01', {
      subject_id: subject.id,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://instagram.com/fake_dr_mehra/?utm_source=ad',
      platform: 'instagram',
      content_type: 'profile',
      raw_payload: {
        bio: 'Dr. Vivek Mehra official consultations. 500% guaranteed return on health products.',
        handle: 'fake_dr_mehra'
      }
    });

    // 3. Correlate signal
    correlationService.correlate(signal, subject);

    // 4. List review queue
    const queue = reviewService.listReviewQueue('org_rev_test', { status: 'pending' });
    expect(queue).toHaveLength(1);

    const item = queue[0];
    expect(item.review.status).toBe('pending');
    expect(item.signal.observed_url).toBe('https://instagram.com/fake_dr_mehra/?utm_source=ad');
    expect(item.subject.canonical_name).toBe('Dr. Vivek Mehra');
    expect(item.correlation).not.toBeNull();
    expect(item.risk_score).not.toBeNull();
    expect(item.risk_score?.score).toBeGreaterThanOrEqual(50);
  });

  it('confirms candidate and spawns a new case linked to the signal', () => {
    const subject = subjectService.createSubject('org_rev_test', 'usr_rev_01', {
      subject_type: 'executive',
      canonical_name: 'Mira Kapoor',
      aliases: ['MK'],
      handles: ['@mirakapoor'],
      official_domains: ['kapoor.io'],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'MANDATE-MK-01',
      monitoring_status: 'active',
      sensitivity: 'critical',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    const { signal } = signalService.ingestSignal('org_rev_test', 'usr_rev_01', {
      subject_id: subject.id,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://x.com/fake_mira_kapoor',
      platform: 'twitter'
    });

    const queue = reviewService.listReviewQueue('org_rev_test', { status: 'pending' });
    const reviewId = queue[0].review.id;

    // Confirm candidate and spawn case
    const confirmed = reviewService.reviewCandidate(
      'org_rev_test',
      reviewId,
      'usr_rev_01',
      'analyst',
      {
        decision: 'confirm_candidate',
        decision_reason: 'Confirmed visual impersonation targeting CEO likeness',
        create_new_case: true,
        case_title: 'Executive Impersonation - Mira Kapoor Fake Profile',
        case_category: 'brand_impersonation',
        priority: 'high'
      }
    );

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.case_id).toBeDefined();

    // Verify case in database
    const createdCase = db.prepare('SELECT * FROM cases WHERE id = ?').get(confirmed.case_id) as any;
    expect(createdCase).toBeDefined();
    expect(createdCase.title).toBe('Executive Impersonation - Mira Kapoor Fake Profile');

    // Verify link created
    const link = db.prepare('SELECT * FROM signal_case_links WHERE signal_id = ? AND case_id = ?').get(
      signal.id,
      confirmed.case_id
    ) as any;
    expect(link).toBeDefined();
    expect(link.link_type).toBe('evidence');
  });

  it('dismisses candidate as parody with false positive category', () => {
    const subject = subjectService.createSubject('org_rev_test', 'usr_rev_01', {
      subject_type: 'creator',
      canonical_name: 'Dev Sharma',
      aliases: [],
      handles: ['@dev_sharma'],
      official_domains: [],
      official_social_urls: [],
      authorization_basis: 'direct_mandate',
      authorization_reference: 'MANDATE-DS-01',
      monitoring_status: 'active',
      sensitivity: 'medium',
      retention_policy_days: 90,
      reference_images_metadata: [],
      reference_audio_metadata: [],
      voice_enrollment_status: 'not_enrolled',
      face_enrollment_status: 'not_enrolled',
      jurisdiction: 'IN'
    });

    const { signal } = signalService.ingestSignal('org_rev_test', 'usr_rev_01', {
      subject_id: subject.id,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://instagram.com/dev_sharma_fanclub_memes',
      platform: 'instagram'
    });

    const queue = reviewService.listReviewQueue('org_rev_test', { status: 'pending' });
    const reviewId = queue[0].review.id;

    const dismissed = reviewService.reviewCandidate(
      'org_rev_test',
      reviewId,
      'usr_rev_01',
      'analyst',
      {
        decision: 'dismiss_parody',
        decision_reason: 'Identified as non-commercial fan meme account with fair use disclaimer',
        false_positive_category: 'satire_parody'
      }
    );

    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.analyst_decision).toBe('dismiss_parody');
    expect(dismissed.false_positive_category).toBe('satire_parody');

    // Verify signal updated
    const sigRow = db.prepare('SELECT * FROM monitoring_signals WHERE id = ?').get(signal.id) as any;
    expect(sigRow.processing_status).toBe('reviewed');
  });
});
