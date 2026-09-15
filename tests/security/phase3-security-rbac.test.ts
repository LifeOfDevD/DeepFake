import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security & RBAC: Phase 3 Separation of Duties and Access Controls', () => {
  let app: any;
  const apexOrgId = 'org_apex_health_01';
  const apexAnalystId = 'usr_apex_analyst_03';
  const apexLegalId = 'usr_apex_legal_04';
  const apexAdminId = 'usr_apex_owner_01';
  const apexClientId = 'usr_apex_client_05'; // read_only_stakeholder
  const secondOrgId = 'org_bharatfin_02';
  const secondOrgUserId = 'usr_bharatfin_mgr_06';

  let testCaseId: string;

  beforeAll(async () => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();

    // Create a base case for testing
    const createRes = await request(app)
      .post('/api/cases')
      .set('x-user-id', apexAnalystId)
      .set('x-organization-id', apexOrgId)
      .send({
        title: 'RBAC Test Impersonation Case',
        category: 'defamation_legal_escalation',
        priority: 'high',
        target_entity: 'Apex Healthcare System',
        contested_url: 'https://twitter.com/fake_apex',
        hosting_platform: 'X / Twitter',
        reported_by_name: 'Compliance Officer',
        reported_by_email: 'compliance@apexhealth.example',
        factual_basis: 'Substantive false accusations regarding emergency care protocols published online.',
        declaration_confirmed: true
      });

    testCaseId = createRes.body.data.id;
  });

  afterAll(() => {
    closeDatabase();
  });

  it('enforces separation of duties: requester cannot self-approve legal review', async () => {
    // 1. Legal reviewer requests legal review (putting themselves as requester)
    await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexLegalId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'awaiting_legal_review',
        reason: 'Requested legal review on sensitive defamation issue.'
      });

    // 2. Same legal reviewer attempts to self-approve with requester_user_id passed as themselves
    const selfApproveRes = await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexLegalId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'legal_review_approved',
        reason: 'Attempting to self-approve my own request.',
        requester_user_id: apexLegalId
      });

    expect(selfApproveRes.status).toBe(400);
    expect(selfApproveRes.body.error.code).toBe('SEPARATION_OF_DUTIES_VIOLATION');
    expect(selfApproveRes.body.error.message).toContain('cannot self-approve');
  });

  it('prohibits Analyst from approving legal review or marking ready for submission', async () => {
    // Attempt legal review approval by Analyst
    const legalApproveRes = await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexAnalystId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'legal_review_approved',
        reason: 'Analyst attempting to approve legal review.'
      });

    expect(legalApproveRes.status).toBe(400);
    expect(legalApproveRes.body.error.code).toBe('LEGAL_ROLE_REQUIRED');

    // Attempt ready for submission by Analyst
    const readyRes = await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexAnalystId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'ready_for_submission',
        reason: 'Analyst attempting to advance directly to ready.'
      });

    expect(readyRes.status).toBe(400);
    expect(readyRes.body.error.code).toBe('ROLE_UNAUTHORIZED');
  });

  it('prohibits Read-Only Stakeholder from modifying approval states', async () => {
    const res = await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexClientId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'awaiting_legal_review',
        reason: 'Stakeholder attempting approval action.'
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('blocks transition to ready_for_submission if readiness checks have blockers', async () => {
    // Have admin approve legal review first
    await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexAdminId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'legal_review_approved',
        reason: 'Admin sign-off on legal review with separation of duties.',
        requester_user_id: apexAnalystId
      });

    // Attempt ready_for_submission without attaching evidence (readiness fails!)
    const readyRes = await request(app)
      .post(`/api/cases/${testCaseId}/approval`)
      .set('x-user-id', apexAdminId)
      .set('x-organization-id', apexOrgId)
      .send({
        to_state: 'ready_for_submission',
        reason: 'Advancing without evidence.'
      });

    expect(readyRes.status).toBe(400);
    expect(readyRes.body.error.code).toBe('READINESS_CHECK_FAILED');
  });

  it('strictly isolates Phase 3 case endpoints across different organizations', async () => {
    // User from secondOrgId attempting to access apexOrgId's case
    const triageRes = await request(app)
      .get(`/api/cases/${testCaseId}/triage`)
      .set('x-user-id', secondOrgUserId)
      .set('x-organization-id', secondOrgId);
    expect(triageRes.status).toBe(404);

    const clockRes = await request(app)
      .get(`/api/cases/${testCaseId}/clocks`)
      .set('x-user-id', secondOrgUserId)
      .set('x-organization-id', secondOrgId);
    expect(clockRes.status).toBe(404);

    const readinessRes = await request(app)
      .get(`/api/cases/${testCaseId}/readiness`)
      .set('x-user-id', secondOrgUserId)
      .set('x-organization-id', secondOrgId);
    expect(readinessRes.status).toBe(404);

    const packetRes = await request(app)
      .get(`/api/cases/${testCaseId}/submission-packet`)
      .set('x-user-id', secondOrgUserId)
      .set('x-organization-id', secondOrgId);
    expect(packetRes.status).toBe(404);
  });
});
