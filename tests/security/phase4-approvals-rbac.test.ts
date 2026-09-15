import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security: Phase 4 Submissions, RBAC & Separation of Duties', () => {
  let app: any;
  const orgId = 'org_apex_health_01';
  const managerId = 'usr_apex_mgr_02';
  const analystId = 'usr_apex_analyst_03';
  const stakeholderId = 'usr_apex_client_05';

  beforeAll(() => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  let testSubmissionId: string;
  let currentPacketHash: string;

  it('creates submission draft and records packet hash', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        case_id: 'case_apex_2026_001',
        platform_id: 'plt_instagram',
        playbook_id: 'pb_synthetic_media'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    testSubmissionId = res.body.data.id;
    currentPacketHash = res.body.data.packet_hash;
    expect(currentPacketHash).toHaveLength(64);
  });

  it('blocks read-only stakeholder from approving facets', async () => {
    const res = await request(app)
      .post(`/api/submissions/${testSubmissionId}/approve`)
      .set('x-user-id', stakeholderId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'evidence_sufficiency',
        decision: 'approved',
        decision_reason: 'Stakeholder attempting approval',
        packet_hash: currentPacketHash
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('blocks approval if packet hash does not match (tampering / modification check)', async () => {
    const res = await request(app)
      .post(`/api/submissions/${testSubmissionId}/approve`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'evidence_sufficiency',
        decision: 'approved',
        decision_reason: 'Verified evidence artifacts',
        packet_hash: 'tampered_or_stale_hash_that_does_not_match_current_hash_123456789012'
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PACKET_HASH_MISMATCH');
  });

  it('enforces separation of duties on legal sufficiency (creator cannot approve legal review)', async () => {
    // analystId created testSubmissionId. If analyst or any non-legal tries legal_sufficiency:
    const analystLegalRes = await request(app)
      .post(`/api/submissions/${testSubmissionId}/approve`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'legal_sufficiency',
        decision: 'approved',
        decision_reason: 'Analyst attempting to approve legal review',
        packet_hash: currentPacketHash
      });

    expect(analystLegalRes.status).toBe(403);

    // If manager created a submission, manager cannot approve legal_sufficiency on own submission
    const mgrSubRes = await request(app)
      .post('/api/submissions')
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        case_id: 'case_apex_2026_001',
        platform_id: 'plt_instagram',
        playbook_id: 'pb_synthetic_media'
      });
    const mgrSubId = mgrSubRes.body.data.id;
    const mgrSubHash = mgrSubRes.body.data.packet_hash;

    const selfApproveRes = await request(app)
      .post(`/api/submissions/${mgrSubId}/approve`)
      .set('x-user-id', managerId)
      .set('x-organization-id', orgId)
      .send({
        approval_facet: 'legal_sufficiency',
        decision: 'approved',
        decision_reason: 'Manager attempting self-approval',
        packet_hash: mgrSubHash
      });

    expect(selfApproveRes.status).toBe(422);
    expect(selfApproveRes.body.error.code).toBe('SEPARATION_OF_DUTIES_VIOLATION');
  });

  it('prevents cross-tenant access to submissions', async () => {
    const crossTenantRes = await request(app)
      .get(`/api/submissions/${testSubmissionId}`)
      .set('x-user-id', 'usr_bharatfin_mgr_06')
      .set('x-organization-id', 'org_bharatfin_02');

    expect(crossTenantRes.status).toBe(404);
  });
});
