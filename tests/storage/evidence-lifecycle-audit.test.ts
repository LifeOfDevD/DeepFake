import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ManagedObjectStorage } from '../../src/storage/managed-object-storage.js';
import { StorageNotFoundError } from '../../src/storage/evidence-storage.js';
import { createDatabaseConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { EvidenceService } from '../../src/services/evidence-service.js';

describe('Storage & Security: Evidence Lifecycle Audit & Managed Object Storage', () => {
  const testDir = path.resolve(process.cwd(), './storage/test_managed_lifecycle_tmp');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('ManagedObjectStorage Implementation', () => {
    it('generates opaque UUID storage keys partitioned by tenant and date', () => {
      const key1 = ManagedObjectStorage.generateOpaqueStorageKey('org_alpha_01', '.png');
      const key2 = ManagedObjectStorage.generateOpaqueStorageKey('org_alpha_01', '.png');

      expect(key1).toContain('org_alpha_01/');
      expect(key1.endsWith('.png')).toBe(true);
      expect(key1).not.toEqual(key2); // Nonce UUID prevents predictability
      expect(key1).not.toContain('..'); // Zero directory traversal
    });

    it('stores objects with KMS encryption metadata sidecars', async () => {
      const storage = new ManagedObjectStorage(
        {
          bucketName: 'response-desk-vault-test',
          region: 'ap-south-1',
          kmsKeyId: 'arn:aws:kms:ap-south-1:111122223333:key/vault-key'
        },
        testDir
      );

      const payload = Buffer.from('TEST_EVIDENCE_ENCRYPTED_PAYLOAD_BYTE_STREAM');
      const key = ManagedObjectStorage.generateOpaqueStorageKey('org_01', '.bin');

      const putRes = await storage.put({
        storageKey: key,
        streamOrBuffer: payload,
        mimeType: 'application/octet-stream'
      });

      expect(putRes.byteSize).toBe(payload.length);
      expect(await storage.exists(key)).toBe(true);

      const meta = await storage.head(key);
      expect(meta.byteSize).toBe(payload.length);

      // Verify sidecar metadata
      const expectedSidecar = path.join(testDir, `${key}.s3meta.json`);
      expect(fs.existsSync(expectedSidecar)).toBe(true);
      const sidecarJson = JSON.parse(fs.readFileSync(expectedSidecar, 'utf8'));
      expect(sidecarJson.serverSideEncryption).toBe('aws:kms');
      expect(sidecarJson.kmsKeyId).toBe('arn:aws:kms:ap-south-1:111122223333:key/vault-key');
    });

    it('generates and verifies pre-signed access URLs with strict TTL and signature validation', () => {
      const storage = new ManagedObjectStorage(
        { bucketName: 'response-desk-vault-test' },
        testDir
      );
      const signingSecret = 'master_presigned_signing_key_32_bytes_min_secret';
      const key = 'org_alpha/2026/09/13/test-evidence-object.bin';

      // 1. Generate presigned URL
      const presigned = storage.generatePresignedDownloadUrl(key, signingSecret, 300);
      expect(presigned.url).toContain('https://response-desk-vault-test.s3.ap-south-1.amazonaws.com');
      expect(presigned.url).toContain('expires=');
      expect(presigned.url).toContain('signature=');

      // Extract query params for verification
      const parsedUrl = new URL(presigned.url);
      const expires = parseInt(parsedUrl.searchParams.get('expires')!, 10);
      const sig = parsedUrl.searchParams.get('signature')!;

      // 2. Validate valid URL
      const validCheck = storage.verifyPresignedUrl(key, expires, sig, signingSecret);
      expect(validCheck.valid).toBe(true);

      // 3. Reject expired timestamp
      const expiredCheck = storage.verifyPresignedUrl(key, expires - 400, sig, signingSecret);
      expect(expiredCheck.valid).toBe(false);
      expect(expiredCheck.reason).toContain('URL_EXPIRED');

      // 4. Reject tampered signature
      const tamperedCheck = storage.verifyPresignedUrl(key, expires, 'bad_signature_abcdef12345', signingSecret);
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.reason).toContain('INVALID_SIGNATURE');
    });

    it('throws StorageNotFoundError when reading non-existent key', async () => {
      const storage = new ManagedObjectStorage({}, testDir);
      await expect(storage.get('non_existent_key_123.bin')).rejects.toThrow(StorageNotFoundError);
    });
  });

  describe('Legal Hold & Deletion Safeguards in Database', () => {
    it('strictly prevents evidence deletion when legal_hold=1', () => {
      const db = createDatabaseConnection({ inMemory: true });
      runMigrations(db);

      // Seed organization, user, case, and evidence item
      db.prepare(`
        INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
        VALUES ('org_lh_01', 'Legal Hold Hospital', 'lh-hospital', 'healthcare', 'IN-DL', 'admin@hospital.in')
      `).run();

      db.prepare(`
        INSERT INTO users (id, email, full_name, password_hash)
        VALUES ('usr_lh_01', 'admin@hospital.in', 'Dr. Legal Admin', 'pw')
      `).run();

      db.prepare(`
        INSERT INTO cases (
          id, organization_id, case_number, title, category, priority, status,
          target_entity, contested_url, hosting_platform, reported_by_email
        ) VALUES (
          'case_lh_01', 'org_lh_01', 'CASE-2026-LH01', 'Legal Hold Incident', 'founder_impersonation',
          'critical', 'new', 'Hospital Inc', 'https://example.com/fake', 'youtube', 'admin@hospital.in'
        )
      `).run();

      db.prepare(`
        INSERT INTO evidence_items (
          id, organization_id, case_id, evidence_type, original_filename, safe_display_name,
          mime_type, detected_mime_type, byte_size, sha256, storage_key,
          status, uploaded_by, retention_until, legal_hold
        ) VALUES (
          'ev_lh_01', 'org_lh_01', 'case_lh_01', 'pdf', 'patient_record.pdf', 'safe_patient_record.pdf',
          'application/pdf', 'application/pdf', 1024, 'abc123hash',
          'org_lh_01/2026/09/13/opaque_uuid_01.pdf', 'available', 'usr_lh_01', '2027-01-01', 1
        )
      `).run();

      const evidenceService = new EvidenceService(db);

      // Attempt deletion while legal_hold is active -> Must throw error
      expect(() => {
        evidenceService.requestDeletion(
          'org_lh_01',
          'ev_lh_01',
          'Compliance retention cycle',
          { user_id: 'usr_lh_01', email: 'admin@hospital.in', role: 'org_owner' }
        );
      }).toThrow(/legal hold/i);

      // Verify item remains available and locked
      const item = db.prepare('SELECT status, legal_hold FROM evidence_items WHERE id = ?').get('ev_lh_01') as any;
      expect(item.status).toBe('available');
      expect(item.legal_hold).toBe(1);
    });
  });
});
