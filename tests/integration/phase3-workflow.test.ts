import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Phase 3 Controlled Intake, Triage, Clock & Simulation Workflow', () => {
  let app: any;
  const orgId = 'org_apex_health_01';
  const analystId = 'usr_apex_analyst_03';
  const legalId = 'usr_apex_legal_04';
  const adminId = 'usr_apex_owner_01';

  beforeAll(() => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('runs complete end-to-end incident lifecycle from intake to simulated submission', async () => {
    // 1. Intake a new high-risk deepfake incident
    const intakePayload = {
      title: 'Deepfake Scam Video Impersonating Chief Surgeon',
      category: 'synthetic_media_endorsement',
      priority: 'high',
      urgency: 'high',
      target_entity: 'Dr. Vikram Malhotra',
      target_entity_type: 'individual_professional',
      contested_url: 'https://instagram.com/p/fake_ad_123?utm_source=ig_web_copy_link',
      hosting_platform: 'Instagram',
      reported_by_name: 'Dr. Vikram Malhotra',
      reported_by_email: 'vikram.m@apexhealth.example',
      harm_type: 'financial_fraud',
      suspected_synthetic_media_type: 'lip_sync_deepfake',
      impersonation_method: 'synthetic_content',
      involves_intimate_imagery: false,
      has_court_or_government_order: false,
      factual_basis: 'Video synthesizes likeness using lip-sync deepfake to sell unapproved pharmaceutical products.',
      declaration_confirmed: true,
      statutory_basis: [
        'IT Act 2000 Section 66D',
        'IT Rules 2021 Rule 3(2)(b)'
      ],
      selected_legal_grounds: [
        'Section 318(4) Bharatiya Nyaya Sanhita 2023 Cheating by Personation'
      ]
    };

    const createRes = await request(app)
      .post('/api/cases')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send(intakePayload);

    expect(createRes.status).toBe(201);
    const caseItem = createRes.body.data;
    const caseId = caseItem.id;
    expect(caseItem.normalized_contested_url).toBe('https://instagram.com/p/fake_ad_123');
    expect(caseItem.approval_status).toBe('draft');
    expect(caseItem.requires_legal_review).toBe(1);

    // 2. Verify automated triage record was generated
    const triageRes = await request(app)
      .get(`/api/cases/${caseId}/triage`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(triageRes.status).toBe(200);
    expect(triageRes.body.data.classification).toBe('synthetic_media_impersonation');
    expect(triageRes.body.data.confidence).toBe('high');
    expect(triageRes.body.data.triggered_rules).toContain('SYNTHETIC_MEDIA_DEEPFAKE_FLAG');

    // 3. Verify statutory clocks were initialized with IT Rules deadlines
    const clockRes = await request(app)
      .get(`/api/cases/${caseId}/clocks`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(clockRes.status).toBe(200);
    expect(clockRes.body.data.clock.timezone).toBe('Asia/Kolkata');
    expect(['running', 'due_soon']).toContain(clockRes.body.data.clock.current_status);
    expect(clockRes.body.data.submission_remaining_hours).toBeGreaterThan(20);

    // 4. Verify workflow task was created for legal review
    const taskRes = await request(app)
      .get('/api/workflow/tasks')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .query({ case_id: caseId });

    expect(taskRes.status).toBe(200);
    const legalTask = taskRes.body.data.find((t: any) => t.task_type === 'legal_review_required');
    expect(legalTask).toBeDefined();
    expect(legalTask.status).toBe('pending');

    // 5. Detect duplicate: Intake another case with identical URL (tracking params stripped)
    const dupeRes = await request(app)
      .post('/api/cases')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        ...intakePayload,
        title: 'Another report of the same deepfake ad',
        contested_url: 'https://www.instagram.com/p/fake_ad_123?fbclid=xyz123'
      });

    expect(dupeRes.status).toBe(201);
    const dupeCaseId = dupeRes.body.data.id;

    const dupesListRes = await request(app)
      .get(`/api/cases/${dupeCaseId}/duplicates`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(dupesListRes.status).toBe(200);
    expect(dupesListRes.body.data.length).toBeGreaterThan(0);
    expect(dupesListRes.body.data[0].matched_case_id).toBe(caseId);

    // 6. Check readiness on primary case (should fail because no evidence attached & legal review pending)
    const preReadinessRes = await request(app)
      .get(`/api/cases/${caseId}/readiness`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(preReadinessRes.status).toBe(200);
    expect(preReadinessRes.body.data.is_ready).toBe(false);
    expect(preReadinessRes.body.data.missing_requirements.some((m: any) => m.code === 'NO_PRESERVED_EVIDENCE')).toBe(true);

    // 7. Attach source URL evidence
    const addEvRes = await request(app)
      .post(`/api/cases/${caseId}/evidence/url`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        source_url: 'https://instagram.com/p/fake_ad_123',
        safe_display_name: 'Deepfake Instagram Video Post',
        sensitivity_level: 'sensitive'
      });
    expect(addEvRes.status).toBe(201);

    // 8. Request legal review
    const reqReviewRes = await request(app)
      .post(`/api/cases/${caseId}/approval`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        to_state: 'awaiting_legal_review',
        reason: 'Analyst packaged preliminary evidence and requests legal review.'
      });
    expect(reqReviewRes.status).toBe(200);
    expect(reqReviewRes.body.data.approval_status).toBe('awaiting_legal_review');

    // 9. Legal Review Approval (Separation of duties: performed by legal reviewer)
    const approveReviewRes = await request(app)
      .post(`/api/cases/${caseId}/approval`)
      .set('x-user-id', legalId)
      .set('x-organization-id', orgId)
      .send({
        to_state: 'legal_review_approved',
        reason: 'Legal counsel reviewed synthesized media and verified prima facie impersonation under IT Rules 2021.'
      });
    expect(approveReviewRes.status).toBe(200);
    expect(approveReviewRes.body.data.approval_status).toBe('legal_review_approved');

    // 10. Check readiness again (all 14 checks should now pass!)
    const postReadinessRes = await request(app)
      .get(`/api/cases/${caseId}/readiness`)
      .set('x-user-id', adminId)
      .set('x-organization-id', orgId);

    expect(postReadinessRes.status).toBe(200);
    expect(postReadinessRes.body.data.is_ready).toBe(true);
    expect(postReadinessRes.body.data.missing_requirements.length).toBe(0);

    // 11. Advance to ready_for_submission
    const readyRes = await request(app)
      .post(`/api/cases/${caseId}/approval`)
      .set('x-user-id', adminId)
      .set('x-organization-id', orgId)
      .send({
        to_state: 'ready_for_submission',
        reason: 'Readiness evaluated and approved for dry-run simulation.'
      });
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.data.approval_status).toBe('ready_for_submission');

    // 12. Generate Submission Packet Preview
    const packetRes = await request(app)
      .get(`/api/cases/${caseId}/submission-packet`)
      .set('x-user-id', adminId)
      .set('x-organization-id', orgId);

    expect(packetRes.status).toBe(200);
    expect(packetRes.body.data.packet_hash).toHaveLength(64);
    expect(packetRes.body.data.packet_markdown).toContain('SIMULATED PILOT SUBMISSION PACKET');

    // 13. Dispatch simulated submission
    const simRes = await request(app)
      .post(`/api/cases/${caseId}/simulate-submission`)
      .set('x-user-id', adminId)
      .set('x-organization-id', orgId);

    expect(simRes.status).toBe(200);
    expect(simRes.body.data.packet.status).toBe('simulated');

    // Verify case approval status is now submission_simulated
    const finalCaseRes = await request(app)
      .get(`/api/cases/${caseId}`)
      .set('x-user-id', adminId)
      .set('x-organization-id', orgId);

    expect(finalCaseRes.status).toBe(200);
    expect(finalCaseRes.body.data.case.approval_status).toBe('submission_simulated');
  });
});
