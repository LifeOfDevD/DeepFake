import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Phase 7 Evaluation, Quality Benchmarks & Safe Intelligence Lifecycle', () => {
  let app: any;
  let db: any;

  const orgId = 'org_apex_health_01';
  const analystId = 'usr_apex_analyst_03';
  const managerId = 'usr_apex_mgr_02';
  const legalId = 'usr_apex_legal_04';

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  let goldenDatasetId: string;
  let testFixtureId: string;

  it('POST /api/evaluation/datasets/seed populates 20 synthetic golden fixtures', async () => {
    const res = await request(app)
      .post('/api/evaluation/datasets/seed')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dataset.id).toMatch(/^ds_/);
    expect(res.body.data.fixtures).toHaveLength(20);

    goldenDatasetId = res.body.data.dataset.id;
    testFixtureId = res.body.data.fixtures[0].id;
  });

  it('GET /api/evaluation/datasets lists datasets and GET :id/fixtures lists fixtures', async () => {
    const listRes = await request(app)
      .get('/api/evaluation/datasets')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.some((d: any) => d.id === goldenDatasetId)).toBe(true);

    const fixRes = await request(app)
      .get(`/api/evaluation/datasets/${goldenDatasetId}/fixtures`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(fixRes.status).toBe(200);
    expect(fixRes.body.success).toBe(true);
    expect(fixRes.body.data).toHaveLength(20);
  });

  it('handles ground-truth labeling, conflict detection, and senior adjudication', async () => {
    // 1. Analyst submits confirmed_candidate label
    const l1Res = await request(app)
      .post(`/api/evaluation/fixtures/${testFixtureId}/labels`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        label: 'confirmed_candidate',
        rationale: 'High resemblance to doctor profile with scam health claim.',
        confidence: 0.95
      });

    expect(l1Res.status).toBe(201);
    expect(l1Res.body.success).toBe(true);

    // 2. Manager submits false_positive label (conflicting label!)
    const l2Res = await request(app)
      .post(`/api/evaluation/fixtures/${testFixtureId}/labels`)
      .set('x-organization-id', orgId)
      .set('x-user-id', managerId)
      .send({
        label: 'false_positive',
        rationale: 'Could be construed as comedic parody and not deceptive.',
        confidence: 0.70
      });

    expect(l2Res.status).toBe(201);
    expect(l2Res.body.success).toBe(true);

    // 3. GET consensus summary shows conflict
    const consensusRes = await request(app)
      .get(`/api/evaluation/fixtures/${testFixtureId}/consensus`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(consensusRes.status).toBe(200);
    expect(consensusRes.body.data.isConflicted).toBe(true);

    // 4. Conflicts endpoint lists this fixture
    const conflictsRes = await request(app)
      .get(`/api/evaluation/datasets/${goldenDatasetId}/conflicts`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(conflictsRes.status).toBe(200);
    expect(conflictsRes.body.data.some((c: any) => c.fixture.id === testFixtureId)).toBe(true);

    // 5. Legal Counsel adjudicates the conflict
    const adjRes = await request(app)
      .post(`/api/evaluation/fixtures/${testFixtureId}/adjudicate`)
      .set('x-organization-id', orgId)
      .set('x-user-id', legalId)
      .send({
        resolved_label: 'confirmed_candidate',
        rationale: 'Binding Legal Adjudication: High medical fraud risk overrides parody defense.',
        statutory_notes: 'Rule 3(1)(b) analysis confirms consumer deception likelihood.'
      });

    expect(adjRes.status).toBe(200);
    expect(adjRes.body.success).toBe(true);
    expect(adjRes.body.data.resolved_label).toBe('confirmed_candidate');

    // 6. Confirm conflict is resolved
    const postAdjRes = await request(app)
      .get(`/api/evaluation/fixtures/${testFixtureId}/consensus`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(postAdjRes.body.data.isConflicted).toBe(false);
    expect(postAdjRes.body.data.consensusLabel).toBe('confirmed_candidate');
  });

  let rulesetId: string;

  it('governs ruleset lifecycle: draft creation -> threshold simulation -> approval -> activation', async () => {
    // 1. Create draft ruleset
    const createRes = await request(app)
      .post('/api/evaluation/rulesets')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        name: 'Enterprise Precision Ruleset V2',
        version_tag: 'v2.0.0-pilot',
        description: 'Tuned factor weights for high-precision fraud suppression'
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('draft');
    expect(createRes.body.data.checksum).toBeDefined();
    rulesetId = createRes.body.data.id;

    // 2. What-if threshold simulation
    const simRes = await request(app)
      .post(`/api/evaluation/rulesets/${rulesetId}/simulate`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        dataset_id: goldenDatasetId,
        threshold_overrides: { alert_threshold: 0.75 }
      });

    expect(simRes.status).toBe(200);
    expect(simRes.body.data.total_evaluated).toBe(20);
    expect(typeof simRes.body.data.average_simulated_score).toBe('number');

    // 3. Approve ruleset as legal counsel
    const approveRes = await request(app)
      .post(`/api/evaluation/rulesets/${rulesetId}/approve`)
      .set('x-organization-id', orgId)
      .set('x-user-id', legalId);

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('approved');
    expect(approveRes.body.data.approved_by_user_id).toBe(legalId);

    // 4. Activate ruleset for tenant
    const activateRes = await request(app)
      .post(`/api/evaluation/rulesets/${rulesetId}/activate`)
      .set('x-organization-id', orgId)
      .set('x-user-id', legalId)
      .send({ reason: 'Approved for production pilot deployment' });

    expect(activateRes.status).toBe(200);
    expect(activateRes.body.data.status).toBe('active');

    // 5. GET active ruleset returns this ruleset
    const activeRes = await request(app)
      .get('/api/evaluation/rulesets/active')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.id).toBe(rulesetId);
  });

  let runId: string;

  it('executes evaluation run and calculates sliced mathematical metrics', async () => {
    const execRes = await request(app)
      .post('/api/evaluation/runs')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        dataset_id: goldenDatasetId,
        ruleset_id: rulesetId,
        run_type: 'offline_validation',
        notes: 'Integration test automated verification run'
      });

    expect(execRes.status).toBe(201);
    expect(execRes.body.success).toBe(true);
    expect(execRes.body.data.run.status).toBe('completed');
    expect(execRes.body.data.run.total_evaluated).toBe(20);
    runId = execRes.body.data.run.id;

    // Fetch sliced metrics
    const metricsRes = await request(app)
      .get(`/api/evaluation/runs/${runId}/metrics`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(metricsRes.status).toBe(200);
    const metrics = metricsRes.body.data;
    expect(metrics.length).toBeGreaterThanOrEqual(4);

    const globalSlice = metrics.find((m: any) => m.slice_dimension === 'global');
    expect(globalSlice).toBeDefined();
    expect(globalSlice.total_signals).toBe(20);
    expect(globalSlice.cost_per_signal_inr).toBe(0.15);
    expect(typeof globalSlice.precision).toBe('number');
    expect(typeof globalSlice.recall).toBe('number');
    expect(typeof globalSlice.brier_calibration_score).toBe('number');
  });

  it('manages suppression rules with fail-closed safety and test simulation', async () => {
    // 1. Create suppression rule
    const createRuleRes = await request(app)
      .post('/api/evaluation/suppressions')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        name: 'Suppress Known Parody News Channel',
        rule_type: 'parody_satire',
        pattern: 'news_parody_hub',
        pattern_type: 'handle',
        justification: 'Established news satire handle',
        expires_in_days: 30,
        ruleset_version: 'v1.0'
      });

    expect(createRuleRes.status).toBe(201);
    const ruleId = createRuleRes.body.data.id;

    // 2. List suppression rules
    const listRes = await request(app)
      .get('/api/evaluation/suppressions')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((r: any) => r.id === ruleId)).toBe(true);

    // 3. Test rule against dataset fixtures
    const testRes = await request(app)
      .post(`/api/evaluation/suppressions/${ruleId}/test`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({ dataset_id: goldenDatasetId });

    expect(testRes.status).toBe(200);
    expect(testRes.body.data.totalFixtures).toBe(20);
    expect(typeof testRes.body.data.suppressedFixtures).toBe('number');
  });

  it('retrieves reviewer quality indicators, feedback proposals, and privacy audit', async () => {
    // Reviewer quality
    const qRes = await request(app)
      .get('/api/evaluation/reviewers/quality')
      .set('x-organization-id', orgId)
      .set('x-user-id', legalId);

    expect(qRes.status).toBe(200);
    expect(qRes.body.success).toBe(true);

    // Feedback proposals
    const fbRes = await request(app)
      .get('/api/evaluation/feedback/proposals')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(fbRes.status).toBe(200);
    expect(fbRes.body.success).toBe(true);

    // Privacy audit
    const privRes = await request(app)
      .get('/api/evaluation/privacy/audit')
      .set('x-organization-id', orgId)
      .set('x-user-id', legalId);

    expect(privRes.status).toBe(200);
    expect(privRes.body.data.isCompliant).toBe(true);
    expect(privRes.body.data.biometricTemplatesStoredCount).toBe(0);
  });
});
