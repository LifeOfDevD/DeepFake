import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';
import { InMemoryEvidenceStorage, StorageError } from '../../src/storage/evidence-storage.js';
import { RetentionService } from '../../src/services/retention-service.js';

describe('Phase 2 Preflight Hardening Verification', () => {
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

  describe('1. Mandatory Download Tokens & Safety', () => {
    let testEvidenceId: string;

    beforeAll(async () => {
      const uploadRes = await request(app)
        .post('/api/cases/case_apex_2026_001/evidence')
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .attach('file', Buffer.concat([pngHeader, Buffer.from('TOKEN_MANDATORY_TEST')]), 'token_test.png');
      testEvidenceId = uploadRes.body.data.id;
    });

    it('strictly rejects tokenless downloads with 401 TOKEN_REQUIRED', async () => {
      const res = await request(app)
        .get(`/api/evidence/${testEvidenceId}/download`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_REQUIRED');
    });

    it('handles malformed signature lengths safely without RangeError crash', async () => {
      // Signature that has different length than expected 43/44-byte base64url HMAC
      const malformedShort = 'eyJldmlkZW5jZUlkIjoidGVzdCJ9.shortsig';
      const malformedLong = 'eyJldmlkZW5jZUlkIjoidGVzdCJ9.very_long_signature_that_exceeds_normal_hmac_length_by_many_bytes_1234567890';

      const resShort = await request(app)
        .get(`/api/evidence/${testEvidenceId}/download?token=${malformedShort}`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01');

      expect(resShort.status).toBe(400);
      expect(resShort.body.error.code).toBe('INVALID_TOKEN');

      const resLong = await request(app)
        .get(`/api/evidence/${testEvidenceId}/download?token=${malformedLong}`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01');

      expect(resLong.status).toBe(400);
      expect(resLong.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rejects download when token was issued for User A but presented by User B', async () => {
      // Token issued for usr_apex_mgr_02
      const tokenRes = await request(app)
        .get(`/api/evidence/${testEvidenceId}/download-token`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01');
      const token = tokenRes.body.data.token;

      // User B (usr_apex_analyst_03) attempts download using User A's token
      const res = await request(app)
        .get(`/api/evidence/${testEvidenceId}/download?token=${token}`)
        .set('x-user-id', 'usr_apex_analyst_03')
        .set('x-organization-id', 'org_apex_health_01');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('sets Deprecation header and canonical link on legacy /token route', async () => {
      const res = await request(app)
        .get(`/api/evidence/${testEvidenceId}/token`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01');

      expect(res.status).toBe(200);
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('download-token');
    });
  });

  describe('2. Failure-Safe Deletion & Consistency', () => {
    let failureEvidenceId: string;

    beforeAll(async () => {
      const uploadRes = await request(app)
        .post('/api/cases/case_apex_2026_001/evidence')
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .attach('file', Buffer.concat([pngHeader, Buffer.from('FAIL_SAFE_TEST')]), 'fail_safe.png');
      failureEvidenceId = uploadRes.body.data.id;

      // Request deletion as analyst
      await request(app)
        .post(`/api/evidence/${failureEvidenceId}/deletion-request`)
        .set('x-user-id', 'usr_apex_analyst_03')
        .set('x-organization-id', 'org_apex_health_01')
        .send({ reason: 'Test failure safety' });
    });

    it('preserves retryable deletion_requested status if physical storage deletion throws unexpected I/O error', async () => {
      // Mock storage delete to simulate physical disk failure
      const originalDelete = inMemoryStorage.delete.bind(inMemoryStorage);
      inMemoryStorage.delete = async () => {
        throw new StorageError('Disk I/O failure during purge', 'DISK_IO_ERROR');
      };

      // Case manager attempts approval
      const res = await request(app)
        .post(`/api/evidence/${failureEvidenceId}/approve-deletion`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .send({ reason: 'Attempt approve during disk failure' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('STORAGE_DELETION_FAILED');

      // VERIFY SQLite STATE: Record MUST NOT be marked deleted!
      const itemRow = testDb.prepare('SELECT status, deleted_at FROM evidence_items WHERE id = ?').get(failureEvidenceId) as any;
      expect(itemRow.status).toBe('deletion_requested');
      expect(itemRow.deleted_at).toBeNull();

      // VERIFY DELETION REQUEST: Still pending!
      const reqRow = testDb.prepare('SELECT status FROM evidence_deletion_requests WHERE evidence_id = ?').get(failureEvidenceId) as any;
      expect(reqRow.status).toBe('pending');

      // Restore storage provider and retry deletion
      inMemoryStorage.delete = originalDelete;

      const retryRes = await request(app)
        .post(`/api/evidence/${failureEvidenceId}/approve-deletion`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .send({ reason: 'Retry after disk restoration' });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.status).toBe('deleted');

      const finalRow = testDb.prepare('SELECT status, deleted_at FROM evidence_items WHERE id = ?').get(failureEvidenceId) as any;
      expect(finalRow.status).toBe('deleted');
      expect(finalRow.deleted_at).toBeDefined();
    });

    it('sets Deprecation header and canonical link on legacy /delete route', async () => {
      // Upload another item to test /delete alias deprecation header
      const uploadRes = await request(app)
        .post('/api/cases/case_apex_2026_001/evidence')
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .attach('file', Buffer.concat([pngHeader, Buffer.from('CANONICAL_TEST')]), 'canon.png');
      const evId = uploadRes.body.data.id;

      await request(app)
        .post(`/api/evidence/${evId}/deletion-request`)
        .set('x-user-id', 'usr_apex_analyst_03')
        .set('x-organization-id', 'org_apex_health_01')
        .send({ reason: 'Check canonical deprecation' });

      const res = await request(app)
        .post(`/api/evidence/${evId}/delete`)
        .set('x-user-id', 'usr_apex_mgr_02')
        .set('x-organization-id', 'org_apex_health_01')
        .send({ reason: 'Approve via legacy route' });

      expect(res.status).toBe(200);
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('approve-deletion');
    });
  });

  describe('3. Retention Enforcement Worker & Idempotency', () => {
    let retentionService: RetentionService;

    beforeAll(() => {
      retentionService = new RetentionService(testDb, inMemoryStorage);
    });

    it('supports starting and stopping background retention worker timer', () => {
      const timer = retentionService.startRetentionWorker(60000);
      expect(timer).toBeDefined();
      retentionService.stopRetentionWorker(timer);
    });

    it('executes runRetentionJobOnce idempotently without error on multiple runs', async () => {
      const res1 = await retentionService.runRetentionJobOnce();
      expect(res1).toBeDefined();
      expect(res1.evaluated).toBeGreaterThanOrEqual(0);

      // Second run immediately after
      const res2 = await retentionService.runRetentionJobOnce();
      expect(res2).toBeDefined();
      expect(res2.purged).toBe(0);
    });
  });
});
