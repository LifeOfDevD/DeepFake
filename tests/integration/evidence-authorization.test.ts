import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Authorization: Evidence Access Controls & Cross-Tenant Guards', () => {
  let app: any;
  let testDb: any;
  let evidenceIdOrg1: string;

  beforeAll(async () => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    const inMemoryStorage = new InMemoryEvidenceStorage();
    const evidenceService = new EvidenceService(testDb, inMemoryStorage);
    setEvidenceService(evidenceService);

    app = createApp();

    // Create an initial evidence item in org_apex_health_01
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        source_url: 'https://video-social.example/posts/111111',
        safe_display_name: 'Apex Confirmed Phish'
      });

    evidenceIdOrg1 = uploadRes.body.data.id;
  });

  afterAll(() => {
    closeDatabase();
  });

  it('prevents Tenant B from viewing Tenant A evidence metadata (returns 404)', async () => {
    // User from BharatFin (org_bharatfin_02) queries Apex's evidence item
    const res = await request(app)
      .get(`/api/evidence/${evidenceIdOrg1}`)
      .set('x-user-id', 'usr_bharatfin_mgr_06')
      .set('x-organization-id', 'org_bharatfin_02');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVIDENCE_NOT_FOUND');
  });

  it('prevents Tenant B from downloading Tenant A evidence', async () => {
    // Tenant B attempts to generate download token for Tenant A's evidence
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceIdOrg1}/download-token`)
      .set('x-user-id', 'usr_bharatfin_mgr_06')
      .set('x-organization-id', 'org_bharatfin_02');

    expect(tokenRes.status).toBe(404);
  });

  it('blocks Read-Only Stakeholder from uploading evidence', async () => {
    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_client_05') // read_only_stakeholder
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        source_url: 'https://test.example/unauth-url',
        safe_display_name: 'Unauthorized URL'
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('blocks Analyst from deleting evidence or releasing legal holds', async () => {
    const deleteRes = await request(app)
      .post(`/api/evidence/${evidenceIdOrg1}/delete`)
      .set('x-user-id', 'usr_apex_analyst_03') // analyst
      .set('x-organization-id', 'org_apex_health_01')
      .send({ reason: 'Unauthorized analyst purge' });

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('restricts ordinary Analysts from downloading quarantined or prohibited evidence', async () => {
    // 1. Mark item as prohibited/quarantined as Case Manager
    await request(app)
      .post(`/api/evidence/${evidenceIdOrg1}/mark-sensitive`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        sensitivity: 'prohibited',
        reason: 'Flagged for statutory quarantine'
      });

    // 2. Analyst attempts to get download token -> MUST BE BLOCKED (403 Forbidden)
    const tokenRes = await request(app)
      .get(`/api/evidence/${evidenceIdOrg1}/download-token`)
      .set('x-user-id', 'usr_apex_analyst_03') // analyst
      .set('x-organization-id', 'org_apex_health_01');

    expect(tokenRes.status).toBe(403);
    expect(tokenRes.body.error.code).toBe('EVIDENCE_ACCESS_DENIED');

    // 3. Legal Counsel CAN generate token and download quarantined evidence for statutory filing
    const counselTokenRes = await request(app)
      .get(`/api/evidence/${evidenceIdOrg1}/download-token`)
      .set('x-user-id', 'usr_apex_legal_04') // legal_reviewer
      .set('x-organization-id', 'org_apex_health_01');

    expect(counselTokenRes.status).toBe(200);

    const counselDownloadRes = await request(app)
      .get(`/api/evidence/${evidenceIdOrg1}/download?token=${counselTokenRes.body.data.token}`)
      .set('x-user-id', 'usr_apex_legal_04')
      .set('x-organization-id', 'org_apex_health_01');

    expect(counselDownloadRes.status).toBe(200);
  });
});
