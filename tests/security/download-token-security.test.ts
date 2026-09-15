import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Security: Download Token Verification & Authorization', () => {
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

  it('generates a time-limited signed download token with maximum 300s TTL', async () => {
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TOKEN_TEST')]), 'doc.png');

    const evidenceId = uploadRes.body.data.id;

    const tokenRes = await request(app)
      .post(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
    expect(tokenRes.body.data.expires_in_seconds).toBe(300);
  });

  it('rejects tampered or forged download tokens', async () => {
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TAMPER_TEST')]), 'doc.png');

    const evidenceId = uploadRes.body.data.id;

    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    const validToken = tokenRes.body.data.token;
    const tamperedToken = validToken.slice(0, -4) + 'abcd';

    const downloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${tamperedToken}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadRes.status).toBe(400);
    expect(downloadRes.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired download tokens', async () => {
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('EXPIRED_TOKEN_TEST')]), 'doc.png');

    const evidenceId = uploadRes.body.data.id;

    // Generate expired token directly via service
    const actor = {
      user_id: 'usr_apex_mgr_02',
      email: 'priya.sharma@apexhealth.example',
      role: 'case_manager' as any,
      ip_address: '127.0.0.1'
    };
    const expiredToken = evidenceService.generateSignedDownloadToken(
      'org_apex_health_01',
      evidenceId,
      actor,
      -10 // Expired 10 seconds ago
    );

    const downloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${expiredToken}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadRes.status).toBe(400);
    expect(downloadRes.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects using a token generated for Evidence A to download Evidence B', async () => {
    // Evidence A
    const uploadResA = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('DOC_A')]), 'doc_a.png');
    const evidenceA = uploadResA.body.data.id;

    // Evidence B
    const uploadResB = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('DOC_B')]), 'doc_b.png');
    const evidenceB = uploadResB.body.data.id;

    // Token for A
    const tokenResA = await request(app)
      .get(`/api/evidence/${evidenceA}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');
    const tokenA = tokenResA.body.data.token;

    // Try downloading B with token A -> MUST BE REJECTED (403)
    const crossRes = await request(app)
      .get(`/api/evidence/${evidenceB}/download?token=${tokenA}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(crossRes.status).toBe(403);
    expect(crossRes.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects token generation and download for deleted evidence (410 Gone)', async () => {
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('TO_DELETE')]), 'to_delete.png');
    const evidenceId = uploadRes.body.data.id;

    // Generate valid download token before deletion
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');
    const preGeneratedToken = tokenRes.body.data.token;

    // Submit deletion request
    await request(app)
      .post(`/api/evidence/${evidenceId}/deletion-request`)
      .set('x-user-id', 'usr_apex_analyst_03')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Purge' });

    // Approve deletion
    await request(app)
      .post(`/api/evidence/${evidenceId}/approve-deletion`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Approved' });

    // Attempting download-token generation on deleted evidence -> 410 Gone
    const tokenAttempt = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenAttempt.status).toBe(410);
    expect(tokenAttempt.body.error.code).toBe('EVIDENCE_DELETED');

    // Attempting download with pre-generated token on deleted evidence -> 410 Gone
    const downloadAttempt = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${preGeneratedToken}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(downloadAttempt.status).toBe(410);
    expect(downloadAttempt.body.error.code).toBe('EVIDENCE_DELETED');

    // Attempting tokenless download on deleted evidence -> 401 TOKEN_REQUIRED
    const tokenlessAttempt = await request(app)
      .get(`/api/evidence/${evidenceId}/download`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenlessAttempt.status).toBe(401);
    expect(tokenlessAttempt.body.error.code).toBe('TOKEN_REQUIRED');
  });
});
