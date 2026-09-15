import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('E2E Journey: Evidence Locker Complete Operational Flow', () => {
  let app: any;
  let testDb: any;
  let inMemoryStorage: InMemoryEvidenceStorage;
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

  it('executes full 13-step evidence operational lifecycle across roles', async () => {
    const orgId = 'org_apex_health_01';
    const caseId = 'case_apex_2026_001';

    // Step 1: Sign in / act as Analyst (Rohit Sen)
    const analystHeaders = { 'x-user-id': 'usr_apex_analyst_03', 'x-organization-id': orgId };

    // Step 2 & 3: Upload synthetic harmless image to seeded case
    const fakeScreenshot = Buffer.concat([pngHeader, Buffer.from('SYNTHETIC_DEEPFAKE_SCREENSHOT_FRAME_42')]);
    const uploadRes = await request(app)
      .post(`/api/cases/${caseId}/evidence`)
      .set(analystHeaders)
      .attach('file', fakeScreenshot, 'suspect_video_frame.png')
      .field('safe_display_name', 'Deepfake Frame 42 Analysis Capture')
      .field('sensitivity', 'normal');

    expect(uploadRes.status).toBe(201);
    const evidenceId = uploadRes.body.data.id;
    expect(evidenceId).toBeDefined();

    // Step 4: Confirm hash and metadata
    const metaRes = await request(app)
      .get(`/api/evidence/${evidenceId}`)
      .set(analystHeaders);

    expect(metaRes.status).toBe(200);
    const evidenceItem = metaRes.body.data.evidence;
    expect(evidenceItem.sha256).toBeDefined();
    expect(evidenceItem.sha256.length).toBe(64);
    expect(evidenceItem.detected_mime_type).toBe('image/png');
    expect(evidenceItem.status).toBe('available');
    expect(evidenceItem.legal_hold).toBe(0);

    // Step 5: View evidence in case list
    const listRes = await request(app)
      .get(`/api/cases/${caseId}/evidence`)
      .set(analystHeaders);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((e: any) => e.id === evidenceId)).toBe(true);

    // Step 6: Download as authorized user using mandatory download token
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set(analystHeaders);
    expect(tokenRes.status).toBe(200);
    const downloadToken = tokenRes.body.data.token;

    const downloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${downloadToken}`)
      .set(analystHeaders);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['etag']).toBe(`"${evidenceItem.sha256}"`);

    // Step 7 & 8: Act as Read-Only Stakeholder (Sunita Rao) -> confirm actions unavailable
    const stakeholderHeaders = { 'x-user-id': 'usr_apex_client_05', 'x-organization-id': orgId };
    const unauthUploadRes = await request(app)
      .post(`/api/cases/${caseId}/evidence`)
      .set(stakeholderHeaders)
      .attach('file', fakeScreenshot, 'blocked.png');
    expect(unauthUploadRes.status).toBe(403);

    const unauthDeleteRes = await request(app)
      .post(`/api/evidence/${evidenceId}/delete`)
      .set(stakeholderHeaders)
      .send({ reason: 'Stakeholder purge attempt' });
    expect(unauthDeleteRes.status).toBe(403);

    // Step 9 & 10: Mark item sensitive / restricted as Legal Counsel (Adv. Menon)
    const counselHeaders = { 'x-user-id': 'usr_apex_legal_04', 'x-organization-id': orgId };
    const markRes = await request(app)
      .post(`/api/evidence/${evidenceId}/mark-sensitive`)
      .set(counselHeaders)
      .send({
        sensitivity: 'prohibited',
        reason: 'Quarantined for potential statutory likeness violation under IT Act 66E'
      });

    expect(markRes.status).toBe(200);
    expect(markRes.body.data.sensitivity).toBe('prohibited');
    expect(markRes.body.data.status).toBe('quarantined');

    // Confirm analyst cannot generate download token for quarantined item
    const blockedTokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set(analystHeaders);
    expect(blockedTokenRes.status).toBe(403);

    // Counsel CAN generate token and download
    const counselTokenRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download-token`)
      .set(counselHeaders);
    expect(counselTokenRes.status).toBe(200);

    const counselDownloadRes = await request(app)
      .get(`/api/evidence/${evidenceId}/download?token=${counselTokenRes.body.data.token}`)
      .set(counselHeaders);
    expect(counselDownloadRes.status).toBe(200);

    // Step 11: Create a legal hold as Legal Counsel
    const holdRes = await request(app)
      .post(`/api/evidence/${evidenceId}/legal-hold`)
      .set(counselHeaders)
      .send({ reason: 'Grievance Appellate Committee (GAC) pending petition' });

    expect(holdRes.status).toBe(201);

    // Step 12: Confirm deletion is blocked
    const mgrHeaders = { 'x-user-id': 'usr_apex_mgr_02', 'x-organization-id': orgId };
    const deleteBlockedRes = await request(app)
      .post(`/api/evidence/${evidenceId}/delete`)
      .set(mgrHeaders)
      .send({ reason: 'Early cleanup' });

    expect(deleteBlockedRes.status).toBe(409);
    expect(deleteBlockedRes.body.error.code).toBe('LEGAL_HOLD_ACTIVE');

    // Step 13: Inspect audit ledger
    const auditRes = await request(app)
      .get('/api/audit-events?limit=20')
      .set(counselHeaders);

    expect(auditRes.status).toBe(200);
    const actions = auditRes.body.data.map((a: any) => a.action);
    expect(actions).toContain('evidence.uploaded');
    expect(actions).toContain('evidence.downloaded');
    expect(actions).toContain('evidence.marked_sensitive');
    expect(actions).toContain('evidence.legal_hold_placed');
  });
});
