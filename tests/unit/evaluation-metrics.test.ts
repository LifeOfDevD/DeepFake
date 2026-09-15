import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { MetricsService } from '../../src/services/evaluation/metrics-service.js';
import { AdjudicationService } from '../../src/services/evaluation/adjudication-service.js';
import { RulesetVersionService } from '../../src/services/evaluation/ruleset-version-service.js';

describe('Unit: MetricsService', () => {
  let db: any;
  let metricsService: MetricsService;
  let adjudicationService: AdjudicationService;
  let rulesetService: RulesetVersionService;
  const orgId = 'org_eval_test';
  const userId = 'user_analyst_01';

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);

    // Seed dummy org and user for foreign keys
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Test Org', 'test-org', 'technology', 'IN-DL', 'contact@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role, is_active)
      VALUES (?, 'analyst@example.com', 'Test Analyst', 'dummyhash', 'analyst', 1)
    `).run(userId);

    metricsService = new MetricsService(db);
    adjudicationService = new AdjudicationService(db);
    rulesetService = new RulesetVersionService(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('executes evaluation run across fixtures and computes global and sliced metrics', () => {
    // 1. Create dataset
    const dataset = adjudicationService.createDataset({
      name: 'Evaluation Metrics Benchmark Dataset',
      version: 'v1.0',
      description: 'Gold standard evaluation fixtures',
      target_subject_types: ['doctor', 'executive'],
      scenario_categories: ['exact_handle_impersonation', 'parody'],
      is_golden: true
    }, userId);

    // 2. Add fixtures: 2 positive matches, 1 false positive / parody
    adjudicationService.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'exact_handle_impersonation',
      synthetic_subject: {
        canonical_name: 'Dr. Ananya Rao',
        subject_type: 'doctor',
        official_domains: ['dra-rao-clinic.example'],
        official_social_urls: ['https://x.com/dr_ananya_rao'],
        handles: ['dr_ananya_rao']
      },
      synthetic_platform: 'x',
      observed_url: 'https://x.com/dr_ananya_rao',
      signal_metadata: {
        handle: 'dr_ananya_rao',
        bio: 'Miracle cure for heart disease. DM for secret herbal drops. Urgent payment.'
      },
      expected_correlation_outcome: 'match',
      expected_risk_band: 'urgent',
      expected_human_review_requirement: 1
    });

    adjudicationService.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'exact_handle_impersonation',
      synthetic_subject: {
        canonical_name: 'Dr. Ananya Rao',
        subject_type: 'doctor',
        official_domains: ['dra-rao-clinic.example'],
        official_social_urls: ['https://telegram.me/dr_ananya_rao'],
        handles: ['dr_ananya_rao']
      },
      synthetic_platform: 'telegram',
      observed_url: 'https://telegram.me/dr_ananya_rao',
      signal_metadata: {
        handle: 'dr_ananya_rao',
        bio: 'Official VIP support crypto giveaway double your funds now.'
      },
      expected_correlation_outcome: 'match',
      expected_risk_band: 'high',
      expected_human_review_requirement: 1
    });

    adjudicationService.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'parody',
      synthetic_subject: {
        canonical_name: 'Dr. Ananya Rao',
        subject_type: 'doctor',
        official_domains: ['dra-rao-clinic.example'],
        official_social_urls: ['https://x.com/dr_ananya_rao'],
        handles: ['dr_ananya_rao']
      },
      synthetic_platform: 'x',
      observed_url: 'https://x.com/dr_ananya_parody',
      signal_metadata: {
        handle: 'dr_ananya_parody',
        bio: 'Parody account mocking medical memes. Not the real doctor.'
      },
      expected_correlation_outcome: 'no_match',
      expected_risk_band: 'low',
      expected_false_positive_label: 'parody',
      expected_human_review_requirement: 1
    });

    // 3. Create ruleset
    const ruleset = rulesetService.createRuleset({
      name: 'High Precision V1',
      factor_weights: {
        exact_handle_weight: 25,
        name_alias_weight: 10,
        domain_similarity_weight: 25,
        scam_keywords_weight: 25,
        brand_asset_weight: 15,
        prior_violation_multiplier: 1.25,
        parody_discount_multiplier: 0.5
      },
      threshold_presets: {
        alert_threshold: 0.5,
        auto_link_threshold: 0.8,
        human_review_threshold: 0.3
      },
      band_cutoffs: {
        informational_max: 19,
        low_max: 39,
        medium_max: 69,
        high_max: 84
      }
    }, userId);

    // 4. Execute evaluation run
    const { run, metrics } = metricsService.executeEvaluationRun({
      organizationId: orgId,
      datasetId: dataset.id,
      rulesetId: ruleset.id,
      executedByUserId: userId,
      runType: 'offline_validation'
    });

    expect(run).toBeDefined();
    expect(run.total_evaluated).toBe(3);
    expect(run.status).toBe('completed');
    expect(metrics.length).toBeGreaterThanOrEqual(4); // global, platform, band, scenario

    // 5. Verify global slice
    const globalMetric = metrics.find(m => m.slice_dimension === 'global');
    expect(globalMetric).toBeDefined();
    expect(globalMetric!.total_signals).toBe(3);
    expect(globalMetric!.cost_per_signal_inr).toBe(0.15);
    expect(typeof globalMetric!.precision).toBe('number');
    expect(typeof globalMetric!.recall).toBe('number');
    expect(typeof globalMetric!.brier_calibration_score).toBe('number');
    expect(typeof globalMetric!.latency_p50_ms).toBe('number');

    // 6. Verify platform slices
    const xMetric = metrics.find(m => m.slice_dimension === 'platform' && m.slice_value === 'x');
    expect(xMetric).toBeDefined();
    expect(xMetric!.total_signals).toBe(2);

    const tgMetric = metrics.find(m => m.slice_dimension === 'platform' && m.slice_value === 'telegram');
    expect(tgMetric).toBeDefined();
    expect(tgMetric!.total_signals).toBe(1);

    // 7. Test getMetricsForRun
    const fetchedMetrics = metricsService.getMetricsForRun(run.id, 'global');
    expect(fetchedMetrics).toHaveLength(1);
    expect(fetchedMetrics[0].run_id).toBe(run.id);
  });

  it('accurately compares two evaluation runs and computes precision and recall deltas', () => {
    // Create dataset with fixtures
    const dataset = adjudicationService.createDataset({
      name: 'Comparison Dataset',
      version: 'v1.0',
      description: 'Run comparison fixtures',
      target_subject_types: ['doctor'],
      scenario_categories: ['exact_handle_impersonation', 'parody'],
      is_golden: true
    }, userId);

    adjudicationService.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'exact_handle_impersonation',
      synthetic_subject: {
        canonical_name: 'Dr. Ananya Rao',
        subject_type: 'doctor',
        official_domains: ['dra-rao-clinic.example'],
        official_social_urls: ['https://x.com/dr_ananya_rao'],
        handles: ['dr_ananya_rao']
      },
      synthetic_platform: 'x',
      observed_url: 'https://x.com/dr_ananya_rao',
      signal_metadata: {
        handle: 'dr_ananya_rao',
        bio: 'Urgent wire transfer required for doctor consultation appointment'
      },
      expected_correlation_outcome: 'match',
      expected_risk_band: 'urgent',
      expected_human_review_requirement: 1
    });

    adjudicationService.addFixture({
      dataset_id: dataset.id,
      scenario_category: 'parody',
      synthetic_subject: {
        canonical_name: 'Dr. Ananya Rao',
        subject_type: 'doctor',
        official_domains: ['dra-rao-clinic.example'],
        official_social_urls: ['https://x.com/dr_ananya_rao'],
        handles: ['dr_ananya_rao']
      },
      synthetic_platform: 'x',
      observed_url: 'https://x.com/dr_ananya_satire',
      signal_metadata: {
        handle: 'dr_ananya_satire',
        bio: 'Parody account. All posts are jokes.'
      },
      expected_correlation_outcome: 'no_match',
      expected_risk_band: 'low',
      expected_false_positive_label: 'parody',
      expected_human_review_requirement: 1
    });

    // Ruleset A (low threshold: 0.2)
    const rulesetA = rulesetService.createRuleset({
      name: 'Ruleset Loose',
      threshold_presets: { alert_threshold: 0.2, auto_link_threshold: 0.8, human_review_threshold: 0.1 }
    }, userId);

    // Ruleset B (high threshold: 0.7)
    const rulesetB = rulesetService.createRuleset({
      name: 'Ruleset Strict',
      threshold_presets: { alert_threshold: 0.7, auto_link_threshold: 0.9, human_review_threshold: 0.5 }
    }, userId);

    const { run: runA } = metricsService.executeEvaluationRun({
      organizationId: orgId,
      datasetId: dataset.id,
      rulesetId: rulesetA.id,
      executedByUserId: userId
    });

    const { run: runB } = metricsService.executeEvaluationRun({
      organizationId: orgId,
      datasetId: dataset.id,
      rulesetId: rulesetB.id,
      executedByUserId: userId
    });

    const comparison = metricsService.compareRuns(runA.id, runB.id);
    expect(comparison.baseRun.id).toBe(runA.id);
    expect(comparison.candidateRun.id).toBe(runB.id);
    expect(typeof comparison.precisionDelta).toBe('number');
    expect(typeof comparison.recallDelta).toBe('number');
    expect(typeof comparison.fprDelta).toBe('number');
    expect(typeof comparison.brierDelta).toBe('number');
  });
});
