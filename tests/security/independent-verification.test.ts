import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { createSessionToken } from '../../src/middleware/auth.js';
import { setConfig, getConfig } from '../../src/config/env.js';
import { ManagedObjectStorage } from '../../src/storage/managed-object-storage.js';
import { PathTraversalError } from '../../src/storage/evidence-storage.js';
import { ProviderSyncService } from '../../src/services/integrations/provider-sync-service.js';
import { EvidenceService, LegalHoldActiveError } from '../../src/services/evidence-service.js';
import fs from 'fs';
import path from 'path';

describe('Adversarial & Independent Security Verification Suite', () => {
  let app: any;
  let testDb: any;
  let storage: ManagedObjectStorage;
  const testStorageDir = path.resolve(process.cwd(), './storage/test_adversarial_evidence');
  const originalConfig = { ...getConfig() };
  const secretKey = 'a_very_secure_test_download_token_secret_32_bytes!';

  // Tenant Alpha (Apex Health) Credentials
  const tenantAlphaOrgId = 'org_apex_health_01';
  const tenantAlphaUser = {
    id: 'usr_apex_mgr_02',
    email: 'priya.nair@apexhealth.example',
    system_role: 'user'
  };
  const tokenAlpha = createSessionToken(tenantAlphaUser);

  // Tenant Beta (BharatFin) Credentials
  const tenantBetaOrgId = 'org_bharatfin_02';
  const tenantBetaUser = {
    id: 'usr_bharatfin_mgr_06',
    email: 'vikram.seth@bharatfin.example',
    system_role: 'user'
  };
  const tokenBeta = createSessionToken(tenantBetaUser);

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }

    storage = new ManagedObjectStorage(
      {
        bucketName: 'adversarial-vault-test',
        region: 'ap-south-1',
        kmsKeyId: 'arn:aws:kms:ap-south-1:123456789012:key/canary-test-key'
      },
      testStorageDir
    );

    app = createApp();
  });

  afterAll(() => {
    setConfig(originalConfig);
    ProviderSyncService.setGlobalKillSwitch(false);
    closeDatabase();
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  describe('1. Cross-Tenant Breakout / BOLA / IDOR Attacks', () => {
    it('prevents Tenant Beta from accessing Tenant Alpha case records', async () => {
      // Find a case belonging to Tenant Alpha
      const alphaCase = testDb.prepare('SELECT id FROM cases WHERE organization_id = ? LIMIT 1').get(tenantAlphaOrgId) as any;
      expect(alphaCase).toBeDefined();

      // Tenant Beta attempts to access Tenant Alpha case
      const res = await request(app)
        .get(`/api/cases/${alphaCase.id}`)
        .set('Authorization', `Bearer ${tokenBeta}`)
        .set('x-organization-id', tenantBetaOrgId);

      // Must fail closed with 403 or 404, never leaking Tenant Alpha data
      expect([403, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('prevents Tenant Alpha from mutating Tenant Beta cases', async () => {
      // Find a case belonging to Tenant Beta
      const betaCase = testDb.prepare('SELECT id FROM cases WHERE organization_id = ? LIMIT 1').get(tenantBetaOrgId) as any;
      expect(betaCase).toBeDefined();

      // Tenant Alpha tries to mutate Tenant Beta's case
      const res = await request(app)
        .patch(`/api/cases/${betaCase.id}/status`)
        .set('Authorization', `Bearer ${tokenAlpha}`)
        .set('x-organization-id', tenantAlphaOrgId)
        .send({ new_status: 'closed', rationale: 'Adversarial closure attempt' });

      expect([400, 403, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Verify the case in DB was NOT mutated
      const unchanged = testDb.prepare('SELECT status FROM cases WHERE id = ?').get(betaCase.id) as any;
      expect(unchanged.status).not.toBe('closed');
    });
  });

  describe('2. Authentication Forgery & Token Tampering', () => {
    it('rejects tokens with forged payloads or invalid HMAC signatures', async () => {
      const forgedToken = tokenAlpha.slice(0, -10) + 'AABBCCDDEE';

      const res = await request(app)
        .get('/api/cases')
        .set('Authorization', `Bearer ${forgedToken}`)
        .set('x-organization-id', tenantAlphaOrgId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body.error)).toMatch(/Bearer authentication failed|UNAUTHORIZED/i);
    });

    it('rejects requests with missing or empty Authorization header in production mode', async () => {
      const prodConfig = { ...originalConfig, nodeEnv: 'production' as const };
      setConfig(prodConfig);
      const prodApp = createApp();

      const res = await request(prodApp)
        .get('/api/cases')
        .set('x-organization-id', tenantAlphaOrgId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);

      setConfig(originalConfig);
    });
  });

  describe('3. Path Traversal & Arbitrary File System Access', () => {
    it('rejects directory traversal payloads in storage download keys', async () => {
      const maliciousTraversalKey = '../../../../etc/passwd';

      await expect(
        storage.get(maliciousTraversalKey)
      ).rejects.toThrow(PathTraversalError);
    });

    it('sanitizes and blocks directory traversal attempts via relative paths in storage exists', async () => {
      const traversalKey = `../../../windows/win.ini`;
      await expect(
        storage.exists(traversalKey)
      ).rejects.toThrow(PathTraversalError);
    });
  });

  describe('4. Pre-Signed URL Tampering & Expiry Enforcement', () => {
    const testObjKey = 'org_apex_health_01/2026/09/13/test-obj.bin';

    it('rejects pre-signed download tokens when the signature is tampered', () => {
      const presigned = storage.generatePresignedDownloadUrl(testObjKey, secretKey, 900);
      const url = new URL(presigned.url);

      const expires = parseInt(url.searchParams.get('expires')!, 10);
      const tamperedSignature = 'tampered_bad_signature_0000000000000000000000000000000000000000';

      const verifyResult = storage.verifyPresignedUrl(testObjKey, expires, tamperedSignature, secretKey);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toContain('INVALID_SIGNATURE');
    });

    it('rejects pre-signed download tokens when expired', () => {
      const presigned = storage.generatePresignedDownloadUrl(testObjKey, secretKey, -60);
      const url = new URL(presigned.url);

      const expires = parseInt(url.searchParams.get('expires')!, 10);
      const sig = url.searchParams.get('signature')!;

      const verifyResult = storage.verifyPresignedUrl(testObjKey, expires, sig, secretKey);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toContain('URL_EXPIRED');
    });

    it('rejects pre-signed download tokens when storage key is altered', () => {
      const presigned = storage.generatePresignedDownloadUrl(testObjKey, secretKey, 900);
      const url = new URL(presigned.url);

      const expires = parseInt(url.searchParams.get('expires')!, 10);
      const sig = url.searchParams.get('signature')!;
      const victimKey = 'org_bharatfin_02/2026/09/13/victim-data.bin';

      const verifyResult = storage.verifyPresignedUrl(victimKey, expires, sig, secretKey);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toContain('INVALID_SIGNATURE');
    });
  });

  describe('5. Emergency Kill-Switch Outbound Blockade', () => {
    it('blocks all provider operations instantly when kill switch is activated', async () => {
      // Activate emergency kill-switch
      ProviderSyncService.setGlobalKillSwitch(true);
      expect(ProviderSyncService.isGlobalKillSwitchActive()).toBe(true);

      const syncService = new ProviderSyncService(testDb);

      // Attempting to execute provider sync must return skipped_paused without outbound calls
      const result = await syncService.syncConnection(tenantAlphaOrgId, 'conn_apex_yt_01', 'usr_apex_mgr_02');
      expect(result.success).toBe(false);
      expect(result.status).toBe('skipped_paused');
      expect(result.error).toContain('KILL_SWITCH_ACTIVE');

      // Restore
      ProviderSyncService.setGlobalKillSwitch(false);
      expect(ProviderSyncService.isGlobalKillSwitchActive()).toBe(false);
    });
  });

  describe('6. Legal Hold Deletion Bypass Defense', () => {
    it('hard-blocks evidence deletion when an active legal hold is attached', async () => {
      const caseId = (testDb.prepare('SELECT id FROM cases WHERE organization_id = ? LIMIT 1').get(tenantAlphaOrgId) as any).id;
      const testStorageKey = 'org_apex_health_01/2026/09/13/adversarial_legal_hold.bin';

      // Insert an evidence item directly with legal_hold = 1
      testDb.prepare(`
        INSERT INTO evidence_items (
          id, organization_id, case_id, evidence_type, original_filename, safe_display_name,
          mime_type, detected_mime_type, byte_size, sha256, storage_key,
          status, uploaded_by, retention_until, legal_hold
        ) VALUES (
          'ev_adv_hold_01', ?, ?, 'file_upload', 'evidence.bin', 'safe_evidence.bin',
          'application/octet-stream', 'application/octet-stream', 2048, 'sha256hashtest', ?,
          'available', 'usr_apex_mgr_02', '2027-01-01', 1
        )
      `).run(tenantAlphaOrgId, caseId, testStorageKey);

      const evidenceService = new EvidenceService(testDb, storage);

      // Attempt deletion via service - MUST throw LegalHoldActiveError
      expect(() => {
        evidenceService.requestDeletion(
          tenantAlphaOrgId,
          'ev_adv_hold_01',
          'Adversarial bypass attempt',
          {
            user_id: 'usr_apex_mgr_02',
            email: 'priya.nair@apexhealth.example',
            role: 'case_manager'
          }
        );
      }).toThrow(LegalHoldActiveError);

      // Verify item still exists and remains on legal hold
      const itemRecord = testDb.prepare('SELECT status, legal_hold FROM evidence_items WHERE id = ?').get('ev_adv_hold_01') as any;
      expect(itemRecord.status).toBe('available');
      expect(itemRecord.legal_hold).toBe(1);
    });
  });
});
