import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Phase 6 Monitoring, Detection Intake & Candidate Review Lifecycle', () => {
  let app: any;
  let db: any;

  const orgId = 'org_apex_health_01';
  const analystId = 'usr_apex_mgr_02';

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('GET /api/monitoring/adapters returns registered safe read-only adapters', async () => {
    const res = await request(app)
      .get('/api/monitoring/adapters')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(res.body.data.every((a: any) => a.is_safe_read_only === 1)).toBe(true);
  });

  it('GET /api/monitoring/quota returns quota metrics and limits', async () => {
    const res = await request(app)
      .get('/api/monitoring/quota')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subjects).toBeDefined();
    expect(res.body.data.signals).toBeDefined();
    expect(res.body.data.subjects.max).toBeGreaterThan(0);
    expect(res.body.data.signals.max_monthly).toBeGreaterThan(0);
  });

  let createdSubjectId: string;
  it('POST /api/monitoring/subjects creates a monitored subject with direct mandate', async () => {
    const res = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        subject_type: 'executive',
        canonical_name: 'Dr. Vikram Sen',
        aliases: ['Vikram Sen', 'V. Sen'],
        handles: ['@dr_vikram_sen'],
        official_domains: ['apexhealth.org'],
        official_social_urls: ['https://instagram.com/dr_vikram_sen'],
        monitoring_status: 'active',
        authorization_basis: 'direct_mandate',
        authorization_reference: 'MANDATE-2026-VS-001',
        jurisdiction: 'IN-DL',
        sensitivity: 'high',
        retention_policy_days: 90
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.canonical_name).toBe('Dr. Vikram Sen');
    createdSubjectId = res.body.data.id;
  });

  let createdPolicyId: string;
  it('POST /api/monitoring/policies creates a detection policy with alert thresholds', async () => {
    const res = await request(app)
      .post('/api/monitoring/policies')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        subject_id: createdSubjectId,
        name: 'Executive Protection Default Policy',
        enabled_signal_types: ['profile', 'post', 'domain'],
        enabled_adapters: ['manual_intake', 'local_fixture', 'file_replay'],
        scan_schedule: 'hourly',
        max_monthly_candidate_volume: 50,
        alert_threshold: 0.70,
        auto_link_threshold: 0.85,
        human_review_threshold: 0.30
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.alert_threshold).toBe(0.70);
    createdPolicyId = res.body.data.id;
  });

  it('POST /api/monitoring/signals/ingest ingests and deduplicates signals', async () => {
    const signalData = {
      subject_id: createdSubjectId,
      policy_id: createdPolicyId,
      adapter_name: 'manual_intake',
      source_type: 'manual_input',
      observed_url: 'https://www.instagram.com/dr_vikram_sen_cure/?utm_source=ad',
      platform: 'instagram',
      content_type: 'profile',
      raw_payload: {
        bio: 'Official consultations by Dr. Vikram Sen. 500% returns on private health schemes.',
        handle: 'dr_vikram_sen_cure'
      }
    };

    // First ingestion
    const res1 = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send(signalData);

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.isDuplicate).toBe(false);
    expect(res1.body.data.signal.id).toBeDefined();
    expect(res1.body.data.signal.normalized_url).toBe('https://instagram.com/dr_vikram_sen_cure');

    // Duplicate ingestion (same normalized URL)
    const res2 = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        ...signalData,
        observed_url: 'https://instagram.com/dr_vikram_sen_cure/?fbclid=track123'
      });

    expect(res2.status).toBe(200);
    expect(res2.body.data.isDuplicate).toBe(true);
    expect(res2.body.data.signal.id).toBe(res1.body.data.signal.id);
  });

  it('POST /api/monitoring/simulate-cycle executes background ingestion and evaluation', async () => {
    const res = await request(app)
      .post('/api/monitoring/simulate-cycle')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evaluation.evaluatedCount).toBeGreaterThanOrEqual(1);
  });

  let targetReviewId: string;
  it('GET /api/monitoring/reviews lists review queue with correlation and transparent scoring', async () => {
    const res = await request(app)
      .get('/api/monitoring/reviews?status=pending')
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const item = res.body.data[0];
    targetReviewId = item.review.id;

    expect(item.review.status).toBe('pending');
    expect(item.signal).toBeDefined();
    expect(item.subject.canonical_name).toBeDefined();
    expect(item.correlation).toBeDefined();
    expect(item.correlation.human_review_mandatory).toBe(1);
    expect(item.risk_score).toBeDefined();
    expect(item.risk_score.disclaimer).toContain('prioritization signal for human review');
  });

  it('POST /api/monitoring/reviews/:id/decision confirms candidate and spawns case with link', async () => {
    const res = await request(app)
      .post(`/api/monitoring/reviews/${targetReviewId}/decision`)
      .set('x-organization-id', orgId)
      .set('x-user-id', analystId)
      .send({
        decision: 'confirm_candidate',
        decision_reason: 'Analyst verified unauthorised profile using registered executive name',
        create_new_case: true,
        case_title: 'Unauthorised Executive Impersonation: Dr. Vikram Sen',
        case_category: 'brand_impersonation',
        priority: 'high'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.case_id).toBeDefined();

    // Verify case in database
    const spawnedCase = db.prepare('SELECT * FROM cases WHERE id = ?').get(res.body.data.case_id) as any;
    expect(spawnedCase).toBeDefined();
    expect(spawnedCase.organization_id).toBe(orgId);
  });

  it('POST /api/monitoring/webhook/:partnerSecret verifies HMAC and rejects spoofing', async () => {
    const secret = 'pilot-partner-secret-999';
    const rawBody = JSON.stringify({
      observed_url: 'https://twitter.com/imposter_apex_ceo',
      platform: 'twitter'
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Generate valid HMAC
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${rawBody}`);
    const validSig = `sha256=${hmac.digest('hex')}`;

    // Valid webhook
    const validRes = await request(app)
      .post(`/api/monitoring/webhook/${secret}`)
      .set('x-hub-signature-256', validSig)
      .set('x-webhook-timestamp', timestamp)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    // Spoofed webhook (wrong secret/signature)
    const invalidRes = await request(app)
      .post(`/api/monitoring/webhook/${secret}`)
      .set('x-hub-signature-256', 'sha256=invalidhexsignature0000000000000000000000000000000000000000000000')
      .set('x-webhook-timestamp', timestamp)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(invalidRes.status).toBe(401);
    expect(invalidRes.body.success).toBe(false);
  });
});
