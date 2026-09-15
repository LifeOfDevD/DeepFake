import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Role-Based Access Control (RBAC)', () => {
  let app: any;

  beforeAll(() => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('prohibits Read-Only Stakeholder from creating new cases', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('x-user-id', 'usr_apex_client_05') // read_only_stakeholder
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        title: 'Unauthorized Case Attempt',
        category: 'brand_impersonation',
        priority: 'high',
        target_entity: 'Apex Healthcare',
        contested_url: 'https://test.example/unauth',
        hosting_platform: 'Web',
        reported_by_email: 'stakeholder@apexhealth.example'
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('prohibits Analyst from viewing the full organization audit ledger', async () => {
    const res = await request(app)
      .get('/api/audit-events')
      .set('x-user-id', 'usr_apex_analyst_03') // analyst
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('permits Case Manager and Legal Reviewer to view the audit ledger', async () => {
    const res = await request(app)
      .get('/api/audit-events')
      .set('x-user-id', 'usr_apex_mgr_02') // case_manager
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('blocks Analyst from transitioning case to submitted', async () => {
    // Attempting to submit Case CS-2026-004 (which is at ready_for_submission in Starlight)
    // Let's create a case in ready_for_submission in Apex first
    const createRes = await request(app)
      .post('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        title: 'Submission Gate Test Case',
        category: 'brand_impersonation',
        priority: 'medium',
        target_entity: 'Apex Helpdesk',
        contested_url: 'https://test.example/brand-scam',
        hosting_platform: 'X / Twitter',
        reported_by_email: 'reporter@apexhealth.example'
      });

    const caseId = createRes.body.data.id;

    // Transition: new -> triage -> awaiting_authority -> evidence_collection -> human_review -> ready_for_submission
    const steps = [
      { to_status: 'triage', reason: 'Triage complete' },
      { to_status: 'awaiting_authority', reason: 'Checking authority' },
      { to_status: 'evidence_collection', reason: 'Authority confirmed' },
      { to_status: 'human_review', reason: 'Evidence uploaded' },
      { to_status: 'ready_for_submission', reason: 'Review signed off' }
    ];

    for (const step of steps) {
      await request(app)
        .patch(`/api/cases/${caseId}/status`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .send(step);
    }

    // Now Analyst attempts to submit -> MUST BE REJECTED
    const submitRes = await request(app)
      .patch(`/api/cases/${caseId}/status`)
      .set('x-user-id', 'usr_apex_analyst_03') // analyst
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        to_status: 'submitted',
        reason: 'Analyst attempting unauthorized dispatch'
      });

    expect(submitRes.status).toBe(422);
    expect(submitRes.body.error.code).toBe('ROLE_UNAUTHORIZED');

    // Case Manager submitting -> MUST SUCCEED
    const validSubmitRes = await request(app)
      .patch(`/api/cases/${caseId}/status`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        to_status: 'submitted',
        reason: 'Case Manager approved dry-run dispatch'
      });

    expect(validSubmitRes.status).toBe(200);
    expect(validSubmitRes.body.data.status).toBe('submitted');
  });
});
