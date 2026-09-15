import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Security: Two-Person Evidence Deletion Workflow & Tombstones', () => {
  let app: any;
  let inMemoryStorage: InMemoryEvidenceStorage;
  let testDb: any;
  let evidenceService: EvidenceService;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    inMemoryStorage = new InMemoryEvidenceStorage();
    evidenceService = new EvidenceService(testDb, inMemoryStorage);
    setEvidenceService(evidenceService);

    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('rejects direct deletion without a prior deletion request', async () => {
    // 1. Upload test evidence
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TEST_DATA')]), 'item1.png');

    const evidenceId = uploadRes.body.data.id;

    // 2. Attempt direct approval/deletion
    const res = await request(app)
      .post(`/api/evidence/${evidenceId}/approve-deletion`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Direct deletion without request' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_PENDING_DELETION_REQUEST');
  });

  it('strictly enforces two-person rule: Requester CANNOT approve their own deletion request', async () => {
    // 1. Upload item
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TEST_DATA_2')]), 'item2.png');

    const evidenceId = uploadRes.body.data.id;

    // 2. Case manager requests deletion
    const reqRes = await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Requesting purge after retention review' });

    expect(reqRes.status).toBe(200);
    expect(reqRes.body.data.status).toBe('deletion_requested');

    // 3. Same case manager attempts to approve deletion -> MUST BE FORBIDDEN (403)
    const approveAttempt = await request(app)
      .post(`/api/evidence/${evidenceId}/approve-deletion`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Self-approving my own deletion' });

    expect(approveAttempt.status).toBe(403);
    expect(approveAttempt.body.error.code).toBe('EVIDENCE_ACCESS_DENIED');
    expect(approveAttempt.body.error.message).toContain('Two-person authorization violation');
  });

  it('allows a distinct authorized operator to approve deletion and preserves tombstone', async () => {
    // 1. Upload item
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TOMBSTONE_TEST_DATA')]), 'tombstone.png');

    const evidenceId = uploadRes.body.data.id;
    const originalHash = uploadRes.body.data.sha256;
    const storageKey = uploadRes.body.data.storage_key;

    // Verify storage object exists
    expect(await inMemoryStorage.exists(storageKey)).toBe(true);

    // 2. Operator 1 (Analyst) requests deletion
    await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Duplicate evidence asset captured in error' });

    // 3. Operator 2 (Legal Reviewer) approves deletion
    const approveRes = await request(app)
      .post(`/api/evidence/${evidenceId}/approve-deletion`)
      .set('x-user-id', 'usr_apex_legal_04')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Legal review confirmed duplicate status, deletion sanctioned' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('deleted');

    // 4. Verify physical storage file is PURGED
    expect(await inMemoryStorage.exists(storageKey)).toBe(false);

    // 5. Verify immutable metadata tombstone is PRESERVED in database
    const dbItem = testDb
      .prepare('SELECT * FROM evidence_items WHERE id = ?')
      .get(evidenceId) as any;

    expect(dbItem).toBeDefined();
    expect(dbItem.status).toBe('deleted');
    expect(dbItem.sha256).toBe(originalHash);
    expect(dbItem.deleted_at).toBeDefined();
    expect(dbItem.deletion_reason).toContain('Legal review confirmed');

    // 6. Verify deletion request record is marked approved
    const delReq = testDb
      .prepare('SELECT * FROM evidence_deletion_requests WHERE evidence_id = ?')
      .get(evidenceId) as any;

    expect(delReq.status).toBe('approved');
    expect(delReq.requested_by).toBe('usr_apex_analyst_03');
    expect(delReq.reviewed_by).toBe('usr_apex_legal_04');
  });

  it('blocks deletion approval while active legal hold is in place', async () => {
    // 1. Upload item
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('HOLD_TEST')]), 'on_hold.png');

    const evidenceId = uploadRes.body.data.id;

    // 2. Request deletion
    await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Cleanup' });

    // 3. Place legal hold
    await request(app)
      .post(`/api/evidence/${evidenceId}/legal-hold`)
      .set('x-user-id', 'usr_apex_legal_04')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Statutory hold under court summons' });

    // 4. Case manager attempts to approve deletion -> MUST BE BLOCKED (409)
    const approveAttempt = await request(app)
      .post(`/api/evidence/${evidenceId}/approve-deletion`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Trying to delete despite hold' });

    expect(approveAttempt.status).toBe(409);
    expect(approveAttempt.body.error.code).toBe('LEGAL_HOLD_ACTIVE');
  });

  it('allows rejecting a deletion request and restoring evidence status', async () => {
    // 1. Upload item
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('REJECT_TEST')]), 'reject_del.png');

    const evidenceId = uploadRes.body.data.id;

    // 2. Request deletion
    await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Mistakenly requested deletion' });

    // 3. Reject deletion
    const rejectRes = await request(app)
      .post(`/api/evidence/${evidenceId}/reject-deletion`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Deletion denied: asset is primary evidence for court' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe('available');

    // Verify deletion request record is marked rejected
    const delReq = testDb
      .prepare('SELECT * FROM evidence_deletion_requests WHERE evidence_id = ?')
      .get(evidenceId) as any;

    expect(delReq.status).toBe('rejected');
    expect(delReq.reviewed_by).toBe('usr_apex_mgr_02');
  });
});
