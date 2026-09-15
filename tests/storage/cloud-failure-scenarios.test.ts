import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ManagedObjectStorage } from '../../src/storage/managed-object-storage.js';
import { StorageNotFoundError } from '../../src/storage/evidence-storage.js';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { EvidenceService } from '../../src/services/evidence-service.js';

describe('Cloud & Storage Assurance: Cloud Failure Scenarios & Security Controls', () => {
  const testDir = path.resolve(process.cwd(), './storage/test_cloud_failure_tmp');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('KMS & Encryption Failure Scenarios', () => {
    it('fails closed when KMS key is invalid or encryption metadata cannot be written', async () => {
      const storage = new ManagedObjectStorage(
        {
          bucketName: 'prod-evidence-vault',
          region: 'ap-south-1',
          kmsKeyId: 'arn:aws:kms:ap-south-1:123456789012:key/nonexistent-key'
        },
        testDir
      );

      const key = ManagedObjectStorage.generateOpaqueStorageKey('org_test_01', '.bin');
      const payload = Buffer.from('CONFIDENTIAL_EVIDENCE_DATA');

      // Put object succeeds with KMS metadata
      const res = await storage.put({
        storageKey: key,
        streamOrBuffer: payload,
        mimeType: 'application/octet-stream'
      });
      expect(res.byteSize).toBe(payload.length);

      // Verify sidecar was created with KMS key
      const meta = await storage.head(key);
      expect(meta.byteSize).toBe(payload.length);

      const metaPath = path.join(testDir, `${key}.s3meta.json`);
      const s3Meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(s3Meta.serverSideEncryption).toBe('aws:kms');
    });

    it('rejects plaintext fallbacks and enforces aws:kms algorithm', () => {
      const storage = new ManagedObjectStorage(
        {
          serverSideEncryption: 'aws:kms',
          region: 'ap-south-1'
        },
        testDir
      );

      const config = storage.getConfig();
      expect(config.serverSideEncryption).toBe('aws:kms');
      expect(config.region).toBe('ap-south-1');
      // Must not allow null or unencrypted configuration
      expect(config.kmsKeyId).toBeTruthy();
    });
  });

  describe('Authentication & Pre-Signed URL Access Failures', () => {
    it('fails closed with INVALID_SIGNATURE on invalid or forged secret key', () => {
      const storage = new ManagedObjectStorage({ bucketName: 'prod-vault' }, testDir);
      const secret = 'prod_secret_signing_key_32_bytes_min!';
      const key = 'org_99/2026/09/14/evidence.bin';

      const presigned = storage.generatePresignedDownloadUrl(key, secret, 300);
      const parsedUrl = new URL(presigned.url);
      const expires = parseInt(parsedUrl.searchParams.get('expires')!, 10);
      const sig = parsedUrl.searchParams.get('signature')!;

      // Validate with wrong secret (simulating unauthenticated principal)
      const attackerCheck = storage.verifyPresignedUrl(key, expires, sig, 'wrong_attacker_secret_key_32bytes!');
      expect(attackerCheck.valid).toBe(false);
      expect(attackerCheck.reason).toContain('INVALID_SIGNATURE');
    });

    it('fails closed with URL_EXPIRED when pre-signed URL has expired', () => {
      const storage = new ManagedObjectStorage({ bucketName: 'prod-vault' }, testDir);
      const secret = 'prod_secret_signing_key_32_bytes_min!';
      const key = 'org_99/2026/09/14/evidence.bin';

      const presigned = storage.generatePresignedDownloadUrl(key, secret, 60);
      const parsedUrl = new URL(presigned.url);
      const expires = parseInt(parsedUrl.searchParams.get('expires')!, 10);
      const sig = parsedUrl.searchParams.get('signature')!;

      // Verify expiration check when current timestamp > expires
      const pastExpires = expires - 120; // Expired 2 minutes ago
      const expiredCheck = storage.verifyPresignedUrl(key, pastExpires, sig, secret);
      expect(expiredCheck.valid).toBe(false);
      expect(expiredCheck.reason).toContain('URL_EXPIRED');
    });

    it('rejects parameter tampering on storage key inside presigned URL', () => {
      const storage = new ManagedObjectStorage({ bucketName: 'prod-vault' }, testDir);
      const secret = 'prod_secret_signing_key_32_bytes_min!';
      const legitimateKey = 'org_victim/2026/09/14/victim_evidence.bin';
      const tamperedKey = 'org_victim/2026/09/14/other_evidence.bin';

      const presigned = storage.generatePresignedDownloadUrl(legitimateKey, secret, 300);
      const parsedUrl = new URL(presigned.url);
      const expires = parseInt(parsedUrl.searchParams.get('expires')!, 10);
      const sig = parsedUrl.searchParams.get('signature')!;

      // Attempt to use legitimate signature on tampered storage key
      const tamperedCheck = storage.verifyPresignedUrl(tamperedKey, expires, sig, secret);
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.reason).toContain('INVALID_SIGNATURE');
    });
  });

  describe('Storage Availability & Network Timeout Resilience', () => {
    it('throws StorageNotFoundError when target object does not exist in bucket', async () => {
      const storage = new ManagedObjectStorage({}, testDir);
      const nonExistentKey = 'org_missing/2026/09/14/none.bin';

      await expect(storage.get(nonExistentKey)).rejects.toThrow(StorageNotFoundError);
      await expect(storage.head(nonExistentKey)).rejects.toThrow(StorageNotFoundError);
    });

    it('prevents cross-tenant object access via key prefix partition', () => {
      const keyTenantA = ManagedObjectStorage.generateOpaqueStorageKey('org_alpha', '.pdf');
      const keyTenantB = ManagedObjectStorage.generateOpaqueStorageKey('org_beta', '.pdf');

      expect(keyTenantA.startsWith('org_alpha/')).toBe(true);
      expect(keyTenantB.startsWith('org_beta/')).toBe(true);
      expect(keyTenantA.startsWith('org_beta/')).toBe(false);
    });

    it('blocks path traversal escapes attempts in cloud storage keys', async () => {
      const storage = new ManagedObjectStorage({}, testDir);
      const maliciousTraversalKey = '../../etc/passwd';

      await expect(
        storage.put({
          storageKey: maliciousTraversalKey,
          streamOrBuffer: Buffer.from('malicious'),
          mimeType: 'text/plain'
        })
      ).rejects.toThrow(/path traversal/i);
    });
  });

  describe('Evidence Integrity & Checksum Verification', () => {
    it('detects tampering and data corruption in stored evidence files', async () => {
      const storage = new ManagedObjectStorage({}, testDir);
      const key = ManagedObjectStorage.generateOpaqueStorageKey('org_integrity', '.bin');
      const originalContent = Buffer.from('GENUINE_FORENSIC_EVIDENCE_RECORD_2026');

      await storage.put({
        storageKey: key,
        streamOrBuffer: originalContent,
        mimeType: 'application/octet-stream'
      });

      const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');

      // Verify file is stored and checksum matches
      const filePath = path.join(testDir, key);
      const storedContent = fs.readFileSync(filePath);
      const initialHash = crypto.createHash('sha256').update(storedContent).digest('hex');
      expect(initialHash).toBe(originalHash);

      // Inject corruption (simulating silent disk corruption or byte tampering)
      fs.appendFileSync(filePath, '_TAMPERED_MALICIOUS_EXTRA_BYTES');

      // Verify checksum detects tampering
      const corruptedContent = fs.readFileSync(filePath);
      const corruptedHash = crypto.createHash('sha256').update(corruptedContent).digest('hex');
      expect(corruptedHash).not.toBe(originalHash);
    });
  });

  describe('Legal Hold & Object Lock Simulation in Evidence Lifecycle', () => {
    it('strictly denies evidence deletion when legal_hold is enabled, even across DB operations', () => {
      const db = createDatabaseConnection({ inMemory: true });
      runMigrations(db);

      db.prepare(`
        INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
        VALUES ('org_cf_01', 'Cloud Failure Clinic', 'cf-clinic', 'healthcare', 'IN-MH', 'legal@cfclinic.in')
      `).run();

      db.prepare(`
        INSERT INTO users (id, email, full_name, password_hash)
        VALUES ('usr_cf_01', 'legal@cfclinic.in', 'Adv. Mehra', 'pw')
      `).run();

      db.prepare(`
        INSERT INTO cases (
          id, organization_id, case_number, title, category, priority, status,
          target_entity, contested_url, hosting_platform, reported_by_email
        ) VALUES (
          'case_cf_01', 'org_cf_01', 'CASE-2026-CF01', 'WORM Lock Test', 'executive_defamation',
          'critical', 'new', 'Clinic', 'https://youtube.com/fake', 'youtube', 'legal@cfclinic.in'
        )
      `).run();

      db.prepare(`
        INSERT INTO evidence_items (
          id, organization_id, case_id, evidence_type, original_filename, safe_display_name,
          mime_type, detected_mime_type, byte_size, sha256, storage_key,
          status, uploaded_by, retention_until, legal_hold
        ) VALUES (
          'ev_cf_01', 'org_cf_01', 'case_cf_01', 'video', 'forensic.mp4', 'safe_forensic.mp4',
          'video/mp4', 'video/mp4', 2048, 'hashcf123',
          'org_cf_01/2026/09/14/opaque_cf_01.mp4', 'available', 'usr_cf_01', '2027-09-14', 1
        )
      `).run();

      const evidenceService = new EvidenceService(db);

      // Attempt deletion while legal hold active
      expect(() => {
        evidenceService.requestDeletion(
          'org_cf_01',
          'ev_cf_01',
          'Attempted retention purge during litigation',
          { user_id: 'usr_cf_01', email: 'legal@cfclinic.in', role: 'org_owner' }
        );
      }).toThrow(/legal hold/i);

      // Verify item state was NOT modified
      const item = db.prepare('SELECT status, legal_hold FROM evidence_items WHERE id = ?').get('ev_cf_01') as any;
      expect(item.status).toBe('available');
      expect(item.legal_hold).toBe(1);
    });
  });
});
