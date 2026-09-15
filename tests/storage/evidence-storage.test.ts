import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  LocalEvidenceStorage,
  InMemoryEvidenceStorage,
  PathTraversalError,
  StorageNotFoundError
} from '../../src/storage/evidence-storage.js';

describe('Storage: Evidence Storage Providers & Path Traversal Guards', () => {
  const testStorageDir = path.resolve(process.cwd(), './storage/test_evidence_tmp');

  beforeEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  describe('LocalEvidenceStorage', () => {
    it('persists and retrieves file bytes with byte-for-byte fidelity', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      const originalPayload = Buffer.from('EVIDENCE_PNG_MOCK_PAYLOAD_BYTE_STREAM_12345');
      const key = 'evidence/org_01/case_01/ev_01/original';

      const putRes = await storage.put({
        storageKey: key,
        streamOrBuffer: originalPayload,
        mimeType: 'image/png'
      });

      expect(putRes.byteSize).toBe(originalPayload.length);
      expect(await storage.exists(key)).toBe(true);

      const stream = await storage.get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const retrievedPayload = Buffer.concat(chunks);

      expect(retrievedPayload.equals(originalPayload)).toBe(true);
    });

    it('rejects unix path traversal attempts (../) with PathTraversalError', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      const maliciousKey = '../../etc/passwd';

      await expect(
        storage.put({
          storageKey: maliciousKey,
          streamOrBuffer: Buffer.from('malicious'),
          mimeType: 'text/plain'
        })
      ).rejects.toThrow(PathTraversalError);

      await expect(storage.get(maliciousKey)).rejects.toThrow(PathTraversalError);
      await expect(storage.exists(maliciousKey)).rejects.toThrow(PathTraversalError);
    });

    it('rejects Windows path traversal attempts (..\\) with PathTraversalError', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      const maliciousKey = 'evidence/..\\..\\Windows\\System32\\cmd.exe';

      await expect(
        storage.put({
          storageKey: maliciousKey,
          streamOrBuffer: Buffer.from('malicious'),
          mimeType: 'text/plain'
        })
      ).rejects.toThrow(PathTraversalError);
    });

    it('rejects null byte injection in storage keys', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      const maliciousKey = 'evidence/org1/case1/ev1\0hidden.png';

      await expect(
        storage.put({
          storageKey: maliciousKey,
          streamOrBuffer: Buffer.from('malicious'),
          mimeType: 'text/plain'
        })
      ).rejects.toThrow(PathTraversalError);
    });

    it('isolates different tenant storage namespaces', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      const keyTenantA = 'evidence/org_apex_01/case_100/ev_01/original';
      const keyTenantB = 'evidence/org_bharatfin_02/case_100/ev_01/original';

      await storage.put({
        storageKey: keyTenantA,
        streamOrBuffer: Buffer.from('PAYLOAD_A'),
        mimeType: 'text/plain'
      });

      await storage.put({
        storageKey: keyTenantB,
        streamOrBuffer: Buffer.from('PAYLOAD_B'),
        mimeType: 'text/plain'
      });

      expect(await storage.exists(keyTenantA)).toBe(true);
      expect(await storage.exists(keyTenantB)).toBe(true);

      // Deleting Tenant A does not affect Tenant B
      await storage.delete(keyTenantA);
      expect(await storage.exists(keyTenantA)).toBe(false);
      expect(await storage.exists(keyTenantB)).toBe(true);
    });

    it('throws StorageNotFoundError when querying non-existent keys', async () => {
      const storage = new LocalEvidenceStorage(testStorageDir);
      await expect(storage.get('evidence/org_01/case_01/ev_missing/original')).rejects.toThrow(
        StorageNotFoundError
      );
    });
  });

  describe('InMemoryEvidenceStorage', () => {
    it('mirrors LocalEvidenceStorage behavior in memory', async () => {
      const memoryStorage = new InMemoryEvidenceStorage();
      const payload = Buffer.from('IN_MEMORY_TEST_PAYLOAD');
      const key = 'evidence/org_test/case_test/ev_test/original';

      await memoryStorage.put({
        storageKey: key,
        streamOrBuffer: payload,
        mimeType: 'text/plain'
      });

      expect(await memoryStorage.exists(key)).toBe(true);

      const stream = await memoryStorage.get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('IN_MEMORY_TEST_PAYLOAD');

      // Traversal rejected
      await expect(memoryStorage.get('../escaped_key')).rejects.toThrow(PathTraversalError);

      await memoryStorage.delete(key);
      expect(await memoryStorage.exists(key)).toBe(false);
    });
  });
});
