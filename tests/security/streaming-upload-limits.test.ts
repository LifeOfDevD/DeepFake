import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Security: Streaming Upload Limits, Executable Rejection & Opaque Keys', () => {
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

  it('rejects executable files (.exe / Windows PE header MZ)', async () => {
    const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', peHeader, 'malicious_payload.exe');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXECUTABLE_REJECTED');
  });

  it('rejects Linux binary executables (ELF magic bytes)', async () => {
    const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', elfHeader, 'rootkit.elf');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXECUTABLE_REJECTED');
  });

  it('rejects shell scripts (shebang header #!/bin/sh)', async () => {
    const scriptBuf = Buffer.from('#!/bin/bash\nrm -rf /');
    const res = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', scriptBuf, 'exploit.sh');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXECUTABLE_REJECTED');
  });

  it('enforces opaque storage key format that isolates user-provided filenames', async () => {
    const userFilename = 'My Secret Photo (2026) [CONFIDENTIAL] #1.png';
    const uploadRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('OPAQUE_TEST')]), userFilename);

    expect(uploadRes.status).toBe(201);
    const item = uploadRes.body.data;

    // Storage key must NOT contain the original user filename or spaces
    expect(item.storage_key).not.toContain('My Secret Photo');
    expect(item.storage_key).not.toContain('CONFIDENTIAL');

    // Storage key must match opaque format: evidence/{org}/{case}/{evidenceId}/payload.png
    expect(item.storage_key).toMatch(/^evidence\/org_apex_health_01\/case_apex_2026_001\/ev_[a-f0-9]+\/payload\.png$/);
  });

  it('cleans up temporary disk files in all paths', async () => {
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink');

    // Attempt invalid upload (malware.exe)
    const failedRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.from([0x4d, 0x5a, 0x00, 0x00]), 'malware.exe');

    expect(failedRes.status).toBe(400);
    expect(unlinkSpy).toHaveBeenCalled();
    const lastUnlinkedFailed = unlinkSpy.mock.calls[unlinkSpy.mock.calls.length - 1][0] as string;
    expect(fs.existsSync(lastUnlinkedFailed)).toBe(false);

    // Successful upload
    unlinkSpy.mockClear();
    const successRes = await request(app)
      .post('/api/cases/case_apex_2026_001/evidence')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .attach('file', Buffer.concat([pngHeader, Buffer.from('CLEANUP_TEST')]), 'cleanup.png');

    expect(successRes.status).toBe(201);
    expect(unlinkSpy).toHaveBeenCalled();
    const lastUnlinkedSuccess = unlinkSpy.mock.calls[unlinkSpy.mock.calls.length - 1][0] as string;
    expect(fs.existsSync(lastUnlinkedSuccess)).toBe(false);

    unlinkSpy.mockRestore();
  });
});
