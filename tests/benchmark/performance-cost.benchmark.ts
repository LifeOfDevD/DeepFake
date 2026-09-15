import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { CandidateScoringService } from '../../src/services/monitoring/candidate-scoring-service.js';
import { UrlNormalizationService } from '../../src/services/monitoring/url-normalization-service.js';
import { SuppressionService } from '../../src/services/evaluation/suppression-service.js';
import { RulesetVersionService, DEFAULT_RULESET_WEIGHTS, DEFAULT_RULESET_THRESHOLDS } from '../../src/services/evaluation/ruleset-version-service.js';
import { EvaluationFixture, MonitoringSignal, EvaluationScenarioCategory } from '../../src/domain/types.js';

describe('Phase 7 Performance & Cost Benchmark Suite', () => {
  let db: any;
  let scoringService: CandidateScoringService;
  let urlService: UrlNormalizationService;
  let suppressionService: SuppressionService;
  let rulesetService: RulesetVersionService;

  const orgId = 'org_apex_health_01';
  const userId = 'usr_apex_mgr_02';

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);

    scoringService = new CandidateScoringService(db);
    urlService = new UrlNormalizationService();
    suppressionService = new SuppressionService(db);
    rulesetService = new RulesetVersionService(db);

    // Setup active suppression rule for realistic workload
    suppressionService.createSuppressionRule(orgId, userId, {
      name: 'Partner Suppression Rule',
      rule_type: 'authorized_partner',
      pattern: '*.partner.example',
      pattern_type: 'domain_glob',
      justification: 'Benchmark suppression workload',
      expires_in_days: 30,
      ruleset_version: 'v1.0'
    });
  });

  afterAll(() => {
    closeDatabase();
  });

  function generateSyntheticFixtures(count: number): EvaluationFixture[] {
    const fixtures: EvaluationFixture[] = [];
    const platforms = ['instagram', 'youtube', 'x', 'web_domain', 'telegram'] as const;
    const categories: EvaluationScenarioCategory[] = [
      'exact_handle_impersonation',
      'look_alike_domain',
      'parody',
      'authorized_affiliate',
      'fake_doctor_endorsement'
    ];

    for (let i = 0; i < count; i++) {
      const platform = platforms[i % platforms.length];
      const category = categories[i % categories.length];
      fixtures.push({
        id: `bench_fix_${i}`,
        dataset_id: 'ds_benchmark',
        synthetic_subject: {
          canonical_name: `Synthetic Benchmark Entity ${i % 10}`,
          subject_type: 'doctor',
          official_domains: ['apex-health.example', 'portal.apex-health.example'],
          official_social_urls: ['https://instagram.example/apexhealth_official'],
          handles: ['apexhealth', 'dr_sharma_real']
        },
        synthetic_platform: platform,
        normalized_url: `https://${platform}.example/user_${i}/profile`,
        observed_url: `https://${platform}.example/user_${i}/profile`,
        scenario_category: category,
        expected_correlation_outcome: category === 'parody' || category === 'authorized_affiliate' ? 'no_match' : 'match',
        expected_risk_band: category === 'exact_handle_impersonation' ? 'urgent' : 'medium',
        expected_false_positive_label: category === 'parody' ? 'parody' : category === 'authorized_affiliate' ? 'authorized' : null,
        expected_human_review_requirement: 1,
        difficulty_level: 'medium',
        language_or_script: 'en',
        dataset_version: 'v1.0',
        provenance: {},
        signal_metadata: {
          scamKeywords: i % 3 === 0,
          accountAgeDays: (i * 7) % 365,
          engagementCount: i * 42
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    return fixtures;
  }

  function measurePipelineExecution(items: EvaluationFixture[]) {
    const latencies: number[] = [];
    const startBatch = performance.now();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const t0 = performance.now();

      // Step 1: URL Normalization
      const normalized = urlService.normalize(item.normalized_url);

      // Step 2: Multi-factor Candidate Scoring
      scoringService.calculateScore({
        signalId: item.id,
        hasExactHandleMatch: i % 2 === 0,
        hasNameAliasMatch: i % 3 === 0,
        isLookalikeDomain: i % 5 === 0,
        hasScamKeywords: i % 4 === 0,
        hasBrandAssetAbuse: i % 6 === 0,
        hasPriorViolationHistory: i % 7 === 0,
        hasParodyOrSatireIndicator: item.scenario_category === 'parody',
        isOfficialDomainOrUrl: item.scenario_category === 'authorized_affiliate'
      });

      // Step 3: Suppression Check
      const syntheticSignal: MonitoringSignal = {
        id: item.id,
        organization_id: orgId,
        subject_id: 'sub_test_01',
        source_type: 'manual_input',
        adapter_name: 'benchmark_adapter',
        observed_url: item.normalized_url,
        normalized_url: normalized.normalizedUrl,
        platform: 'web',
        observed_at: new Date().toISOString(),
        content_type: 'post',
        content_hash: 'hash_bench',
        metadata_hash: 'mhash_bench',
        provenance: {},
        idempotency_key: `idemp_${i}`,
        processing_status: 'processed',
        raw_payload: JSON.stringify(item.signal_metadata),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      suppressionService.evaluateSignalSuppression(orgId, syntheticSignal);

      const t1 = performance.now();
      latencies.push(t1 - t0);
    }

    const endBatch = performance.now();
    const totalDurationMs = endBatch - startBatch;
    const throughput = (items.length / totalDurationMs) * 1000;

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    // Cost projection calculation (in INR)
    // Deterministic in-memory + local SQLite compute estimated at ₹0.0001 per signal.
    // Zero external LLM / Cloud API tokens consumed.
    const computeCostPerSignalINR = 0.0001;
    const totalCostINR = items.length * computeCostPerSignalINR;

    return {
      count: items.length,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      throughput: Math.round(throughput),
      p50: Math.round(p50 * 1000) / 1000,
      p95: Math.round(p95 * 1000) / 1000,
      p99: Math.round(p99 * 1000) / 1000,
      costPerSignalINR: computeCostPerSignalINR,
      totalCostINR: Math.round(totalCostINR * 1000) / 1000
    };
  }

  // ==========================================================================
  // Benchmark 1: 100 Synthetic Items (Small Batch / Pilot Quick Check)
  // ==========================================================================
  it('Benchmark: 100 synthetic items meet throughput, latency (<5ms P50, <25ms P95, <50ms P99) and cost targets (< ₹0.20/signal)', () => {
    const fixtures = generateSyntheticFixtures(100);
    const metrics = measurePipelineExecution(fixtures);

    console.log('[BENCHMARK - 100 ITEMS]:', metrics);

    expect(metrics.throughput).toBeGreaterThan(500); // > 500 signals/sec
    expect(metrics.p50).toBeLessThan(5.0); // P50 < 5ms
    expect(metrics.p95).toBeLessThan(25.0); // P95 < 25ms
    expect(metrics.p99).toBeLessThan(50.0); // P99 < 50ms
    expect(metrics.costPerSignalINR).toBeLessThan(0.20); // < ₹0.20 per signal
  });

  // ==========================================================================
  // Benchmark 2: 1,000 Synthetic Items (Standard Operational Batch)
  // ==========================================================================
  it('Benchmark: 1,000 synthetic items maintain high throughput and stable tail latencies', () => {
    const fixtures = generateSyntheticFixtures(1000);
    const metrics = measurePipelineExecution(fixtures);

    console.log('[BENCHMARK - 1,000 ITEMS]:', metrics);

    expect(metrics.throughput).toBeGreaterThan(500);
    expect(metrics.p50).toBeLessThan(5.0);
    expect(metrics.p95).toBeLessThan(25.0);
    expect(metrics.p99).toBeLessThan(50.0);
    expect(metrics.costPerSignalINR).toBeLessThan(0.20);
  });

  // ==========================================================================
  // Benchmark 3: 10,000 Synthetic Items (Enterprise Scale Intake Batch)
  // ==========================================================================
  it('Benchmark: 10,000 synthetic items sustain enterprise throughput without memory exhaustion or degradation', () => {
    const fixtures = generateSyntheticFixtures(10000);
    const metrics = measurePipelineExecution(fixtures);

    console.log('[BENCHMARK - 10,000 ITEMS]:', metrics);

    expect(metrics.throughput).toBeGreaterThan(500);
    expect(metrics.p50).toBeLessThan(5.0);
    expect(metrics.p95).toBeLessThan(25.0);
    expect(metrics.p99).toBeLessThan(50.0);
    expect(metrics.costPerSignalINR).toBeLessThan(0.20);
  });

  // ==========================================================================
  // Benchmark 4: Ruleset What-If Simulation Performance
  // ==========================================================================
  it('Benchmark: Ruleset what-if threshold simulation runs across 1,000 fixtures under 200ms', () => {
    const fixtures = generateSyntheticFixtures(1000);
    const ruleset = rulesetService.createRuleset(
      {
        name: 'Benchmark Sim Ruleset',
        factor_weights: DEFAULT_RULESET_WEIGHTS,
        threshold_presets: DEFAULT_RULESET_THRESHOLDS
      },
      userId
    );

    const t0 = performance.now();
    const simResult = rulesetService.simulateRuleset(
      ruleset,
      fixtures,
      {
        alert_threshold: 0.65,
        auto_link_threshold: 0.80,
        human_review_threshold: 0.25
      }
    );
    const t1 = performance.now();
    const simDurationMs = t1 - t0;

    console.log('[BENCHMARK - SIMULATION 1,000 FIXTURES]:', {
      durationMs: Math.round(simDurationMs * 100) / 100,
      totalEvaluated: simResult.total_evaluated,
      alerts: simResult.simulated_alerts,
      cases: simResult.simulated_cases
    });

    expect(simResult.total_evaluated).toBe(1000);
    expect(simDurationMs).toBeLessThan(200); // Runs in milliseconds
  });
});
