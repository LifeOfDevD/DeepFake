import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security: Monitoring Intake, Quotas, Webhook Tamper, and Human Verification Guarantees', () => {
  let app: any;
  let db: any;

  const orgId = 'org_apex_health_01';
  const userId = 'usr_apex_mgr_02'; // case_manager role
  const otherOrgId = 'org_bharatfin_02';
  const otherUserId = 'usr_bharatfin_mgr_06'; // risk manager in other org

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('rejects signal intake for unmandated or non-active subjects (draft / pending_authorization / paused)', async () => {
    // 1. Create a subject in 'pending_authorization' status
    const pendingRes = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Pending Mandate',
        subject_type: 'doctor',
        authorization_basis: 'direct_mandate',
        authorization_reference: 'MANDATE-PENDING-001',
        monitoring_status: 'pending_authorization',
        official_domains: ['drpending.org'],
        official_social_urls: ['https://instagram.com/drpending']
      });

    expect(pendingRes.status).toBe(201);
    const pendingSubjectId = pendingRes.body.data.id;

    // Ingesting signal for pending subject must fail with 400
    const pendingIngestRes = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: pendingSubjectId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/drpending_fake_cures'
      });

    expect(pendingIngestRes.status).toBe(400);
    expect(pendingIngestRes.body.success).toBe(false);
    const pendingErrMsg = pendingIngestRes.body.error?.message || pendingIngestRes.body.error;
    expect(pendingErrMsg).toContain('SUBJECT_UNAUTHORIZED');

    // 2. Create a subject in 'draft' status
    const draftRes = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Draft Status',
        subject_type: 'doctor',
        authorization_basis: 'representation_agreement',
        authorization_reference: 'REP-AGR-DRAFT-002',
        monitoring_status: 'draft',
        official_domains: ['drdraft.org']
      });

    expect(draftRes.status).toBe(201);
    const draftSubjectId = draftRes.body.data.id;

    const draftIngestRes = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: draftSubjectId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/drdraft_fake_post'
      });

    expect(draftIngestRes.status).toBe(400);
    const draftErrMsg = draftIngestRes.body.error?.message || draftIngestRes.body.error;
    expect(draftErrMsg).toContain('SUBJECT_UNAUTHORIZED');

    // 3. Update subject to 'paused' and verify ingestion remains blocked
    await request(app)
      .put(`/api/monitoring/subjects/${draftSubjectId}`)
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({ monitoring_status: 'paused' });

    const pausedIngestRes = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: draftSubjectId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/drdraft_fake_post'
      });

    expect(pausedIngestRes.status).toBe(400);
    const pausedErrMsg = pausedIngestRes.body.error?.message || pausedIngestRes.body.error;
    expect(pausedErrMsg).toContain('SUBJECT_UNAUTHORIZED');
  });

  it('enforces organizational quota limits on monitored subjects', async () => {
    // Check current subjects and set quota limit to current count
    const quotaRes = await request(app)
      .get('/api/monitoring/quota')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId);

    const currentSubjects = quotaRes.body.data.subjects.current;

    // Set max_monitored_subjects exactly to currentSubjects
    db.prepare(`
      UPDATE pilot_entitlements
      SET max_monitored_subjects = ?
      WHERE organization_id = ?
    `).run(currentSubjects, orgId);

    // Attempting to register another subject must be rejected with 403
    const overQuotaRes = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Over Quota',
        subject_type: 'doctor',
        authorization_basis: 'direct_mandate',
        authorization_reference: 'MANDATE-OVER-001',
        monitoring_status: 'active'
      });

    expect(overQuotaRes.status).toBe(403);
    expect(overQuotaRes.body.success).toBe(false);
    const overErrMsg = overQuotaRes.body.error?.message || overQuotaRes.body.error;
    expect(overErrMsg).toContain('QUOTA_EXCEEDED');

    // Restore quota for subsequent tests
    db.prepare(`
      UPDATE pilot_entitlements
      SET max_monitored_subjects = 50
      WHERE organization_id = ?
    `).run(orgId);
  });

  it('enforces organizational monthly signal ingestion quota limits', async () => {
    // Create an active subject
    const subjRes = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Quota Signal Test',
        subject_type: 'doctor',
        authorization_basis: 'direct_mandate',
        authorization_reference: 'MANDATE-SIG-001',
        monitoring_status: 'active'
      });

    const subjId = subjRes.body.data.id;

    // Set max monthly signals to current month count
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const curMonthSignals = (db.prepare(`
      SELECT COUNT(*) as count FROM monitoring_signals
      WHERE organization_id = ? AND observed_at LIKE ?
    `).get(orgId, `${monthPrefix}%`) as any).count;

    db.prepare(`
      UPDATE pilot_entitlements
      SET max_monthly_monitoring_signals = ?
      WHERE organization_id = ?
    `).run(curMonthSignals, orgId);

    // Ingesting another signal must be rejected with 403
    const overSignalRes = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: subjId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/drquota_fake'
      });

    expect(overSignalRes.status).toBe(403);
    expect(overSignalRes.body.success).toBe(false);
    const sigErrMsg = overSignalRes.body.error?.message || overSignalRes.body.error;
    expect(sigErrMsg).toContain('QUOTA_EXCEEDED');

    // Restore limit
    db.prepare(`
      UPDATE pilot_entitlements
      SET max_monthly_monitoring_signals = 500
      WHERE organization_id = ?
    `).run(orgId);
  });

  it('verifies webhook HMAC-SHA256 signature and rejects forged or drifted requests', async () => {
    const partnerSecret = 'partner_secret_test_key_12345';
    const payload = JSON.stringify({
      signals: [
        {
          observed_url: 'https://youtube.com/watch?v=webhook123',
          platform: 'youtube',
          content_type: 'video'
        }
      ]
    });

    const now = Math.floor(Date.now() / 1000);
    const validSignature = crypto
      .createHmac('sha256', partnerSecret)
      .update(`${now}.${payload}`)
      .digest('hex');

    // 1. Valid signature & current timestamp succeeds
    const validRes = await request(app)
      .post(`/api/monitoring/webhook/${partnerSecret}`)
      .set('x-webhook-signature', `sha256=${validSignature}`)
      .set('x-webhook-timestamp', now.toString())
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.data.received_count).toBe(1);

    // 2. Forged signature fails with 401
    const forgedRes = await request(app)
      .post(`/api/monitoring/webhook/${partnerSecret}`)
      .set('x-webhook-signature', 'sha256=invalid_forged_hash_value_00000000000000000000000000000000')
      .set('x-webhook-timestamp', now.toString())
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(forgedRes.status).toBe(401);
    expect(forgedRes.body.success).toBe(false);
    const forgedErrMsg = forgedRes.body.error?.message || forgedRes.body.error;
    expect(forgedErrMsg).toContain('INVALID_SIGNATURE');

    // 3. Expired timestamp (> 300s in the past) fails with 401
    const expiredTimestamp = now - 400;
    const expiredSig = crypto
      .createHmac('sha256', partnerSecret)
      .update(`${expiredTimestamp}.${payload}`)
      .digest('hex');

    const expiredRes = await request(app)
      .post(`/api/monitoring/webhook/${partnerSecret}`)
      .set('x-webhook-signature', `sha256=${expiredSig}`)
      .set('x-webhook-timestamp', expiredTimestamp.toString())
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(expiredRes.status).toBe(401);
    const expErrMsg = expiredRes.body.error?.message || expiredRes.body.error;
    expect(expErrMsg).toContain('INVALID_SIGNATURE');
  });

  it('blocks path traversal attacks in file replay adapter', async () => {
    // Attempt replay with directory traversal path
    const traversalRes = await request(app)
      .post('/api/monitoring/signals/replay')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: 'subj_test_001',
        file_path: '../../../../windows/system32/drivers/etc/hosts'
      });

    expect(traversalRes.status).toBe(400);
  });

  it('enforces strict cross-tenant isolation on monitoring resources', async () => {
    // 1. Create a subject in Org A
    const subjA = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Tenant A Private',
        subject_type: 'doctor',
        authorization_basis: 'direct_mandate',
        authorization_reference: 'MANDATE-TENANT-A-01',
        monitoring_status: 'active'
      });

    const subjAId = subjA.body.data.id;

    // 2. User from Org B attempts to view Subject A -> 404
    const getResB = await request(app)
      .get(`/api/monitoring/subjects/${subjAId}`)
      .set('x-organization-id', otherOrgId)
      .set('x-user-id', otherUserId);

    expect(getResB.status).toBe(404);

    // 3. User from Org B attempts to ingest signal for Subject A -> 400 (Subject not authorized in Org B)
    const ingestResB = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', otherOrgId)
      .set('x-user-id', otherUserId)
      .send({
        subject_id: subjAId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/dr_tenant_a_fake'
      });

    expect(ingestResB.status).toBe(400);
    const bErrMsg = ingestResB.body.error?.message || ingestResB.body.error;
    expect(bErrMsg).toContain('SUBJECT_UNAUTHORIZED');
  });

  it('guarantees mandatory human review on all correlated candidates and blocks automatic case creation', async () => {
    // 1. Create an active subject with official channels
    const activeSubj = await request(app)
      .post('/api/monitoring/subjects')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        canonical_name: 'Dr. Human Review Guarantee',
        subject_type: 'doctor',
        authorization_basis: 'representation_agreement',
        authorization_reference: 'REP-AGR-HUMAN-01',
        monitoring_status: 'active',
        official_domains: ['guaranteedoc.org'],
        official_social_urls: ['https://instagram.com/guaranteedoc_real']
      });

    const sId = activeSubj.body.data.id;

    // Count cases before signal intake
    const initialCasesCount = (db.prepare('SELECT COUNT(*) as count FROM cases WHERE organization_id = ?').get(orgId) as any).count;

    // Ingest candidate signal
    const ingestRes = await request(app)
      .post('/api/monitoring/signals/ingest')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        subject_id: sId,
        adapter_name: 'manual_intake',
        source_type: 'manual_input',
        observed_url: 'https://instagram.com/guaranteedoc_real_cures_fake',
        platform: 'instagram',
        content_type: 'profile'
      });

    expect(ingestRes.status).toBe(201);
    const signalId = ingestRes.body.data.signal.id;

    // Fetch review item created for this signal
    const reviewItem = db.prepare('SELECT * FROM candidate_reviews WHERE signal_id = ?').get(signalId) as any;
    expect(reviewItem).toBeDefined();
    expect(reviewItem.status).toBe('pending');
    expect(reviewItem.decision).toBeFalsy();
    const reviewId = reviewItem.id;

    // Run evaluation cycle to correlate candidate signal
    await request(app)
      .post('/api/monitoring/simulate-cycle')
      .set('x-organization-id', orgId)
      .set('x-user-id', userId);

    // Check correlation in database: human_review_mandatory MUST be 1
    const correlation = db.prepare('SELECT * FROM candidate_correlations WHERE signal_id = ?').get(signalId) as any;
    expect(correlation).toBeDefined();
    expect(correlation.human_review_mandatory).toBe(1);

    // Verify ZERO automatic cases created
    const postIngestCasesCount = (db.prepare('SELECT COUNT(*) as count FROM cases WHERE organization_id = ?').get(orgId) as any).count;
    expect(postIngestCasesCount).toBe(initialCasesCount);

    // Affirmative human analyst review decision creates the case
    const decisionRes = await request(app)
      .post(`/api/monitoring/reviews/${reviewId}/decision`)
      .set('x-organization-id', orgId)
      .set('x-user-id', userId)
      .send({
        decision: 'confirm_candidate',
        decision_reason: 'Confirmed deceptive medical impersonation with unauthorized brand trademark use.',
        create_new_case: true,
        case_title: 'Impersonation Incident - Dr. Human Review Guarantee',
        case_category: 'founder_doctor_creator_impersonation',
        priority: 'critical'
      });

    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.success).toBe(true);
    expect(decisionRes.body.data.status).toBe('confirmed');
    expect(decisionRes.body.data.case_id).toBeDefined();

    // Now case count MUST have incremented by 1
    const finalCasesCount = (db.prepare('SELECT COUNT(*) as count FROM cases WHERE organization_id = ?').get(orgId) as any).count;
    expect(finalCasesCount).toBe(initialCasesCount + 1);

    // Verify SignalCaseLink was created
    const link = db.prepare('SELECT * FROM signal_case_links WHERE signal_id = ? AND case_id = ?').get(
      signalId,
      decisionRes.body.data.case_id
    ) as any;
    expect(link).toBeDefined();
    expect(link.link_type).toBe('evidence');
  });
});
