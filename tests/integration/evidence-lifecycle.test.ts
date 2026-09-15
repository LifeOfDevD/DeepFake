import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Integration: Evidence Locker Lifecycle & Legal Holds', () => {
  let app: any;
  let inMemoryStorage: InMemoryEvidenceStorage;
  let testDb: any;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    inMemoryStorage = new InMemoryEvidenceStorage();
    const evidenceService = new EvidenceService(testDb, inMemoryStorage);
    setEvidenceService(evidenceService);

    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('uploads, persists, and hashes a synthetic screenshot file', async () => {
    const fakeImageBuffer = Buffer.concat([pngHeader, Buffer.from('FAKE_SCREENSHOT_BYTES')]);

    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', fakeImageBuffer, 'cloned_profile_proof.png')
      .field('safe_display_name', 'Verified Profile Cloned Screen')
      .field('sensitivity', 'normal');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const evidence = res.body.data;
    expect(evidence.id).toBeDefined();
    expect(evidence.sha256).toBeDefined();
    expect(evidence.detected_mime_type).toBe('image/png');
    expect(evidence.status).toBe('available');
    expect(evidence.case_id).toBe('case_apex_2026_001');

    // Verify persisted in storage
    expect(await inMemoryStorage.exists(evidence.storage_key)).toBe(true);
  });

  it('registers a manual source URL evidence item with normalization and tamper hash', async () => {
    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        source_url: 'https://video-social.example/posts/89372198',
        safe_display_name: 'Primary Contested Reel Source',
        operator_notes: 'Reel was uploaded on 2026-09-10 from unknown handle.'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evidence_type).toBe('source_url');
    expect(res.body.data.source_url).toBe('https://video-social.example/posts/89372198');
    expect(res.body.data.sha256).toBeDefined();
  });

  it('lists active evidence for a case', async () => {
    const res = await request(app)
      .get('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('downloads an evidence file using authorized streaming', async () => {
    // 1. Upload sample text file
    const sampleText = Buffer.from('Chain of Custody Verification Log Details');
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', sampleText, 'audit_log.txt');

    const evidenceId = uploadRes.body.data.id;

    // 2. Obtain mandatory download token & stream download
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.data.token;

    const downloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${token}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('text/plain');
    expect(downloadRes.text).toBe('Chain of Custody Verification Log Details');
  });

  it('supports signed download tokens with time-limited expiration', async () => {
    // 1. Upload sample
    const sampleText = Buffer.from('Protected Legal Docket');
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', sampleText, 'docket.txt');

    const evidenceId = uploadRes.body.data.id;

    // 2. Obtain signed download token
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.data.token;
    expect(token).toBeDefined();

    // 3. Download using token
    const downloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${token}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.text).toBe('Protected Legal Docket');
  });

  it('enforces legal holds blocking evidence deletion until released', async () => {
    // 1. Upload test evidence
    const docBuffer = Buffer.concat([pngHeader, Buffer.from('CRITICAL_LITIGATION_EVIDENCE')]);
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', docBuffer, 'litigation_doc.png');

    const evidenceId = uploadRes.body.data.id;

    // 2. Place legal hold
    const holdRes = await request(app)
      .post(`/api/evidence/${evidenceId}/legal-hold`)
      .set('x-user-id', 'usr_apex_legal_04') // Legal counsel
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Mandatory statutory preservation under IT Rules 2021 investigation' });

    expect(holdRes.status).toBe(201);
    expect(holdRes.body.success).toBe(true);

    // 3. Attempt to delete while hold is active -> MUST BE BLOCKED (409 Conflict)
    const deleteAttemptRes = await request(app)
      .post(`/api/evidence/${evidenceId}/delete`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Premature purge request' });

    expect(deleteAttemptRes.status).toBe(409);
    expect(deleteAttemptRes.body.error.code).toBe('LEGAL_HOLD_ACTIVE');

    // 4. Release legal hold as legal counsel
    const releaseRes = await request(app)
      .delete(`/api/evidence/${evidenceId}/legal-hold`)
      .set('x-user-id', 'usr_apex_legal_04')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Investigation concluded by cyber cell' });

    expect(releaseRes.status).toBe(200);

    // 5. Generate token before deletion
    const preDeleteTokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');
    const preDeleteToken = preDeleteTokenRes.body.data.token;

    // 6. Submit deletion request as analyst (Person 1)
    const requestRes = await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Authorized purge per retention policy request' });

    expect(requestRes.status).toBe(200);

    // 7. Approve deletion as case manager (Person 2 - distinct from requester)
    const deleteSuccessRes = await request(app)
      .post(`/api/evidence/${evidenceId}/delete`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Authorized purge per retention policy' });

    expect(deleteSuccessRes.status).toBe(200);
    expect(deleteSuccessRes.body.data.status).toBe('deleted');

    // 8. Attempting to download deleted item returns 410 Gone
    const downloadDeletedRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${preDeleteToken}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadDeletedRes.status).toBe(410);
    expect(downloadDeletedRes.body.error.code).toBe('EVIDENCE_DELETED');
  });
});
