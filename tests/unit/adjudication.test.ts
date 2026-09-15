import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { AdjudicationService } from '../../src/services/evaluation/adjudication-service.js';

describe('Unit: AdjudicationService', () => {
  let db: any;
  let service: AdjudicationService;
  const userId1 = 'user_reviewer_01';
  const userId2 = 'user_reviewer_02';
  const leadUserId = 'user_lead_01';

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_01', 'Test Org', 'test-org', 'tech', 'IN-DL', 'test@example.com')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role, is_active)
      VALUES
        (?, 'rev1@example.com', 'Reviewer 1', 'hash', 'analyst', 1),
        (?, 'rev2@example.com', 'Reviewer 2', 'hash', 'analyst', 1),
        (?, 'lead@example.com', 'Lead Reviewer', 'hash', 'case_manager', 1)
    `).run(userId1, userId2, leadUserId);

    service = new AdjudicationService(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('manages dataset creation, listing, and fixture population', () => {
    const dataset = service.createDataset({
      name: 'Adjudication Benchmark Dataset',
      version: 'v1.0.0',
      description: 'Gold standard dataset for testing adjudication',
      target_subject_types: ['executive', 'doctor'],
      scenario_categories: ['exact_handle_impersonation', 'look_alike_domain'],
      is_golden: true
    }, leadUserId);

    expect(dataset.id).toMatch(/^ds_/);
    expect(dataset.name).toBe('Adjudication Benchmark Dataset');
    expect(dataset.is_golden).toBe(1);

    const fixture = service.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'look_alike_domain',
      synthetic_subject: {
        canonical_name: 'Alpha Bank',
        subject_type: 'institutional_entity',
        official_domains: ['alphabank.example'],
        official_social_urls: []
      },
      synthetic_platform: 'domain',
      observed_url: 'https://alphabank-login.example/verify',
      signal_metadata: { domain: 'alphabank-login.example' },
      expected_correlation_outcome: 'match',
      expected_risk_band: 'urgent',
      difficulty_level: 'hard'
    });

    expect(fixture.id).toMatch(/^fix_/);
    expect(fixture.normalized_url).toBe('https://alphabank-login.example/verify');

    const retrievedFixture = service.getFixtureById(fixture.id);
    expect(retrievedFixture).toBeDefined();
    expect(retrievedFixture!.scenario_category).toBe('look_alike_domain');

    const fixtures = service.listFixtures(dataset.id);
    expect(fixtures).toHaveLength(1);

    const updatedDataset = service.getDatasetById(dataset.id);
    expect(updatedDataset!.total_fixtures).toBe(1);
  });

  it('records reviewer labels and accurately detects reviewer conflict/disagreement', () => {
    const dataset = service.createDataset({
      name: 'Conflict Test Dataset',
      version: 'v1.0.0'
    }, leadUserId);

    const fixture = service.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'parody',
      synthetic_subject: {
        canonical_name: 'Satire Brand',
        subject_type: 'brand_trademark',
        official_domains: ['satirebrand.example'],
        official_social_urls: []
      },
      synthetic_platform: 'x',
      observed_url: 'https://x.com/satirebrand_parody',
      expected_correlation_outcome: 'no_match',
      expected_risk_band: 'low'
    });

    // Reviewer 1 labels it as benign parody
    const label1 = service.submitLabel(fixture.id, userId1, 'rev1@example.com', {
      label: 'false_positive',
      rationale: 'Bio clearly indicates parody and satire purpose without deception.',
      confidence: 0.95
    });

    expect(label1.id).toMatch(/^gtl_/);

    // Initial consensus has 1 label, no conflict
    const consensus1 = service.getConsensusSummary(fixture.id);
    expect(consensus1.isConflicted).toBe(false);

    // Reviewer 2 labels it as confirmed candidate (disagreement!)
    const label2 = service.submitLabel(fixture.id, userId2, 'rev2@example.com', {
      label: 'confirmed_candidate',
      rationale: 'Uses official brand trademark in header image, potential confusion.',
      confidence: 0.8
    });

    expect(label2.id).toMatch(/^gtl_/);

    // Check consensus summary
    const consensus = service.getConsensusSummary(fixture.id);
    expect(consensus.totalLabels).toBe(2);
    expect(consensus.distinctReviewers).toBe(2);
    expect(consensus.isConflicted).toBe(true);
    expect(consensus.consensusLabel).toBeNull(); // No consensus due to conflict

    // Check listConflictedFixtures
    const conflicted = service.listConflictedFixtures(dataset.id);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0].fixture.id).toBe(fixture.id);
  });

  it('allows senior adjudicator to resolve conflicted fixture with binding rationale', () => {
    const dataset = service.createDataset({
      name: 'Adjudication Resolution Dataset',
      version: 'v1.0.0'
    }, leadUserId);

    const fixture = service.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'criticism',
      synthetic_subject: {
        canonical_name: 'Global Corp',
        subject_type: 'institutional_entity',
        official_domains: ['globalcorp.example'],
        official_social_urls: []
      },
      synthetic_platform: 'domain',
      observed_url: 'https://globalcorp-complaints.example',
      expected_correlation_outcome: 'no_match',
      expected_risk_band: 'low'
    });

    // Conflicting labels
    service.submitLabel(fixture.id, userId1, 'rev1@example.com', {
      label: 'confirmed_candidate',
      rationale: 'Contains corporate brand logo.',
      confidence: 0.7
    });

    service.submitLabel(fixture.id, userId2, 'rev2@example.com', {
      label: 'false_positive',
      rationale: 'Consumer grievance and review board, nominative fair use.',
      confidence: 0.95
    });

    // Adjudicator resolves
    const adjudication = service.adjudicateFixture(fixture.id, leadUserId, 'lead@example.com', {
      resolved_label: 'false_positive',
      rationale: 'Adjudicated: Nominative fair use established under safe harbor principles.',
      statutory_notes: 'Rule 3(1)(b) analysis indicates grievance reporting rather than deceptive impersonation.'
    });

    expect(adjudication.id).toMatch(/^adj_/);
    expect(adjudication.resolved_label).toBe('false_positive');

    // After adjudication, consensus should reflect resolved label
    const consensus = service.getConsensusSummary(fixture.id);
    expect(consensus.isConflicted).toBe(false); // Resolved
    expect(consensus.consensusLabel).toBe('false_positive');
    expect(consensus.adjudication).toBeDefined();
    expect(consensus.adjudication!.id).toBe(adjudication.id);

    // List conflicted fixtures should now be empty
    const conflicted = service.listConflictedFixtures(dataset.id);
    expect(conflicted).toHaveLength(0);
  });

  it('loads all 20 fixtures from the synthetic seed catalog', () => {
    const { dataset, fixtures } = service.loadSeedCatalog(leadUserId);
    expect(dataset.id).toMatch(/^ds_/);
    expect(fixtures).toHaveLength(20);

    const categories = new Set(fixtures.map(f => f.scenario_category));
    expect(categories.size).toBe(20); // Covers all 20 distinct scenario categories

    // Check reserved domains in synthetic subjects
    for (const fix of fixtures) {
      for (const domain of fix.synthetic_subject.official_domains) {
        expect(domain).toMatch(/\.example$/);
      }
    }
  });
});
