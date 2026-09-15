import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Security: Evidence Safety, Sanitization & Network Invariants', () => {
  let app: any;
  let testDb: any;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    const inMemoryStorage = new InMemoryEvidenceStorage();
    const evidenceService = new EvidenceService(testDb, inMemoryStorage);
    setEvidenceService(evidenceService);

    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('sanitizes hostile filenames containing path traversal or XSS payloads', async () => {
    const fakeBuffer = Buffer.concat([pngHeader, Buffer.from('SAFE_PAYLOAD')]);
    const hostileFilename = '../../<script>alert("xss")</script>.png';

    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', fakeBuffer, hostileFilename);

    expect(res.status).toBe(201);
    const item = res.body.data;

    // File name must not contain directory traversal or script tags
    expect(item.safe_display_name).not.toContain('..');
    expect(item.safe_display_name).not.toContain('<script>');
    expect(item.original_filename).not.toContain('<script>');
  });

  it('rejects internal IP addresses (SSRF) in manual source URL capture', async () => {
    const ssrfUrls = [
      'http://127.0.0.1:8080/admin',
      'http://localhost/secret',
      'http://169.254.169.254/latest/meta-data',
      'ftp://example.com/test'
    ];

    for (const url of ssrfUrls) {
      const res = await request(app)
        .post('/api/cases/case_apex_2026_001/evidence')
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .send({
          source_url: url,
          safe_display_name: 'SSRF Probe'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('automatically sets status to quarantined when sensitivity is marked prohibited', async () => {
    const fakeBuffer = Buffer.concat([pngHeader, Buffer.from('PROHIBITED_SAMPLE')]);

    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', fakeBuffer, 'sensitive_sample.png')
      .field('sensitivity', 'prohibited');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.sensitivity).toBe('prohibited');
    expect(uploadRes.body.data.status).toBe('quarantined');
  });

  it('records audit events without logging raw file contents or sensitive bytes', () => {
    const audits = testDb
      .prepare("SELECT * FROM audit_events WHERE action LIKE 'evidence.%'")
      .all() as any[];

    expect(audits.length).toBeGreaterThan(0);
    for (const aud of audits) {
      const details = aud.details;
      // Details must not contain raw binary or base64 dumps
      expect(details).not.toContain('SAFE_PAYLOAD');
      expect(details).not.toContain('PROHIBITED_SAMPLE');
    }
  });
});
