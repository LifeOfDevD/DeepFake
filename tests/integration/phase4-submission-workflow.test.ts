import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Phase 4 Grievance Operations & Submission Control Plane', () => {
  let app: any;
  const orgId = 'org_apex_health_01';
  const managerId = 'usr_apex_mgr_02';
  const analystId = 'usr_apex_analyst_03';
  const legalId = 'usr_apex_legal_04';

  beforeAll(() => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('runs complete operational submission lifecycle from playbook selection to takedown recording', async () => {
    // 1. Incident Intake
    const intakeRes = await request(app)
      .post('/api/cases')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        title: 'Deepfake Scam Video on Instagram Impersonating Dr. Verma',
        category: 'synthetic_media_endorsement',
        priority: 'high',
        urgency: 'critical',
        target_entity: 'Dr. Anand K. Verma',
        target_entity_type: 'individual_professional',
        contested_url: 'https://instagram.example/reel/ph4_sim_test',
        hosting_platform: 'instagram',
        reported_by_name: 'Priya Nair',
        reported_by_email: 'priya.nair@apexhealth.example',
        suspected_synthetic_media_type: 'face_swap_video',
        impersonation_method: 'synthetic_content',
        harm_type: 'medical_misinformation',
        involves_intimate_imagery: false,
        statutory_basis: ['IT Rules 2021 Rule 3(2)(b)', 'IT Act Sec 66D']
      });

    expect(intakeRes.status).toBe(201);
    const caseId = intakeRes.body.data.id;

    // 2. Verify Statutory Clock with Statutory Source Discipline
    const clockRes = await request(app)
      .get(`/api/cases/${caseId}/clocks`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(clockRes.status).toBe(200);
    expect(clockRes.body.data.clock).toBeDefined();
    expect(clockRes.body.data.operational_rule).toBe('IT_RULES_2021_RULE_3_2_B');
    expect(clockRes.body.data.deadline_type).toBe('legally_mandatory');

    // 3. Attach Evidence
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const uploadRes = await request(app)
      .post(`/api/cases/${caseId}/evidence`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .attach('file', Buffer.concat([pngHeader, Buffer.from('FORENSIC_SNAPSHOT')]), 'forensic_capture.png');

    expect(uploadRes.status).toBe(201);

    // 4. Create Submission Draft with Playbook pb_synthetic_media
    const subRes = await request(app)
      .post('/api/submissions')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        case_id: caseId,
        platform_id: 'plt_instagram',
        playbook_id: 'pb_synthetic_media'
      });

    expect(subRes.status).toBe(201);
    const submissionId = subRes.body.data.id;
    const initialHash = subRes.body.data.packet_hash;
    expect(subRes.body.data.status).toBe('draft');

    // 5. Preview Notice and Manifest
    const previewRes = await request(app)
      .get(`/api/submissions/${submissionId}/preview`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.renderedNotice).toContain('SIMULATED SUBMISSION NOTICE');
    expect(previewRes.body.data.manifest.length).toBeGreaterThan(0);

    // 6. Validate Submission
    const valRes = await request(app)
      .post(`/api/submissions/${submissionId}/validate`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(valRes.status).toBe(200);
    expect(valRes.body.data.isValid).toBe(true);

    // 7. Faceted Approvals (evidence sufficiency, route selection, legal sufficiency)
    // Step 7a: Evidence Sufficiency by Manager
    const appEvidence = await request(app)
      .post(`/api/submissions/${submissionId}/approve`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'evidence_sufficiency',
        decision: 'approved',
        decision_reason: 'Forensic PNG capture verified with valid SHA-256',
        packet_hash: initialHash
      });
    expect(appEvidence.status).toBe(200);

    // Step 7b: Route Selection by Manager
    const appRoute = await request(app)
      .post(`/api/submissions/${submissionId}/approve`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'platform_route_selection',
        decision: 'approved',
        decision_reason: 'Instagram Nodal Grievance under IT Rules 2021 verified',
        packet_hash: initialHash
      });
    expect(appRoute.status).toBe(200);

    // Step 7c: Legal Sufficiency by Legal Reviewer (Separation of duties)
    const appLegal = await request(app)
      .post(`/api/submissions/${submissionId}/approve`)
      .set('x-user-id', legalId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'legal_sufficiency',
        decision: 'approved',
        decision_reason: 'Prima facie Section 66D IT Act violation established',
        packet_hash: initialHash
      });
    expect(appLegal.status).toBe(200);

    // Step 7d: Simulation Approval
    const appSim = await request(app)
      .post(`/api/submissions/${submissionId}/approve`)
      .set('x-user-id', legalId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'simulated_submission',
        decision: 'approved',
        decision_reason: 'All requirements satisfied. Approved for dry-run simulation.',
        packet_hash: initialHash
      });
    expect(appSim.status).toBe(200);

    // Check submission status is now approved_for_simulation
    const afterAppRes = await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(afterAppRes.body.data.status).toBe('approved_for_simulation');

    // 8. Execute Dry-Run Simulation (Zero external network requests)
    const simRes = await request(app)
      .post(`/api/submissions/${submissionId}/simulate`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId);

    expect(simRes.status).toBe(200);
    expect(simRes.body.data.submission.status).toBe('simulated_submitted');
    expect(simRes.body.data.simulation.simulatedReferenceId).toMatch(/^SIM-INSTAGRAM-\d{4}-[A-F0-9]{8}$/);

    // 9. Manually Record Platform Acknowledgement
    const ackRes = await request(app)
      .post(`/api/submissions/${submissionId}/responses/acknowledgement`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        platform_reference_number: 'META-TICKET-2026-98711',
        operator_notes: 'Platform Nodal Officer acknowledged ticket within 4 hours.'
      });

    expect(ackRes.status).toBe(201);
    expect(ackRes.body.data.platform_reference_number).toBe('META-TICKET-2026-98711');

    // Verify submission status moved to acknowledged
    const afterAck = await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(afterAck.body.data.status).toBe('acknowledged');

    // 10. Manually Record Platform Decision: Content Removed
    const decRes = await request(app)
      .post(`/api/submissions/${submissionId}/responses/decision`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        response_category: 'takedown_completed',
        takedown_result: 'removed',
        platform_reference_number: 'META-TICKET-2026-98711',
        operator_notes: 'Platform disabled reel citing Impersonation Policy.'
      });

    expect(decRes.status).toBe(201);
    expect(decRes.body.data.takedown_result).toBe('removed');

    // Verify submission status moved to action_taken
    const afterDec = await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(afterDec.body.data.status).toBe('action_taken');

    // 11. Create Escalation for re-occurrence
    const escRes = await request(app)
      .post('/api/escalations')
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        case_id: caseId,
        submission_id: submissionId,
        trigger_type: 'repeated_reupload',
        severity: 'p2',
        recommended_next_action: 'gac_appeal_rule_3a',
        notes: 'Follow-up escalation in case mirror accounts emerge'
      });

    expect(escRes.status).toBe(201);
    expect(escRes.body.data.recommended_next_action).toBe('gac_appeal_rule_3a');

    // 12. Add Related Content Re-upload Observation
    const reuploadRes = await request(app)
      .post('/api/re-uploads')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        case_id: caseId,
        observed_url: 'https://instagram.example/reel/ph4_mirror_clip_02?ref=share',
        platform_id: 'plt_instagram',
        target_entity: 'Dr. Anand K. Verma',
        relationship: 'mirror',
        similarity_score: 1.0,
        operator_notes: 'Mirrored video snippet detected on auxiliary profile'
      });

    expect(reuploadRes.status).toBe(201);
    expect(reuploadRes.body.data.relationship).toBe('mirror');

    // 13. Verify Audit Transitions Ledger
    const transRes = await request(app)
      .get(`/api/submissions/${submissionId}/transitions`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId);

    expect(transRes.status).toBe(200);
    const transitions = transRes.body.data.map((t: any) => t.to_state);
    expect(transitions).toContain('draft');
    expect(transitions).toContain('approved_for_simulation');
    expect(transitions).toContain('simulated_submitted');
    expect(transitions).toContain('acknowledged');
    expect(transitions).toContain('action_taken');
  });
});
