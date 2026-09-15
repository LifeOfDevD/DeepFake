import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RetentionService } from '../../src/services/retention-service.js';
import { setDatabaseInstance, closeDatabase, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { InMemoryEvidenceStorage } from '../../src/storage/evidence-storage.js';
import { setEvidenceService, EvidenceService } from '../../src/services/evidence-service.js';

describe('Security: Retention Policy Enforcement Worker', () => {
  let testDb: any;
  let inMemoryStorage: InMemoryEvidenceStorage;
  let evidenceService: EvidenceService;
  let retentionService: RetentionService;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);

    inMemoryStorage = new InMemoryEvidenceStorage();
    evidenceService = new EvidenceService(testDb, inMemoryStorage);
    setEvidenceService(evidenceService);

    retentionService = new RetentionService(testDb, inMemoryStorage);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('purges expired evidence and preserves tombstone metadata', async () => {
    // 1. Upload item
    const actor = {
      user_id: 'usr_apex_mgr_02',
      email: 'priya.sharma@apexhealth.example',
      role: 'case_manager' as any,
      ip_address: '127.0.0.1'
    };

    const item = await evidenceService.uploadEvidence(
      'org_apex_health_01',
      'case_apex_2026_001',
      {
        originalFilename: 'expired_item.png',
        declaredMimeType: 'image/png',
        fileBuffer: Buffer.concat([pngHeader, Buffer.from('EXPIRED_DATA')]),
        safeDisplayName: 'Expired Item'
      },
      actor
    );

    // Verify storage object exists
    expect(await inMemoryStorage.exists(item.storage_key)).toBe(true);

    // 2. Set retention_until to the past (yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare('UPDATE evidence_items SET retention_until = ? WHERE id = ?')
      .run(yesterday, item.id);

    // 3. Run retention worker (dryRun = true)
    const dryResult = await retentionService.purgeExpiredEvidence({
      dryRun: true,
      organizationId: 'org_apex_health_01'
    });

    expect(dryResult.evaluated).toBeGreaterThanOrEqual(1);
    expect(dryResult.purged).toBeGreaterThanOrEqual(1);
    expect(dryResult.purgedEvidenceIds).toContain(item.id);

    // Storage object should still exist in dry run
    expect(await inMemoryStorage.exists(item.storage_key)).toBe(true);

    // 4. Run retention worker (live purge)
    const liveResult = await retentionService.purgeExpiredEvidence({
      dryRun: false,
      organizationId: 'org_apex_health_01'
    });

    expect(liveResult.purgedEvidenceIds).toContain(item.id);

    // Storage object should now be DELETED
    expect(await inMemoryStorage.exists(item.storage_key)).toBe(false);

    // Database record should be status = 'retention_expired' with tombstone preserved
    const updated = testDb
      .prepare('SELECT * FROM evidence_items WHERE id = ?')
      .get(item.id) as any;

    expect(updated.status).toBe('retention_expired');
    expect(updated.sha256).toBe(item.sha256);
    expect(updated.deleted_at).toBeDefined();
    expect(updated.deletion_reason).toContain('retention policy');

    // Audit event recorded
    const audit = testDb
      .prepare("SELECT * FROM audit_events WHERE action = 'evidence.retention_purged' AND resource_id = ?")
      .get(item.id) as any;

    expect(audit).toBeDefined();
  });

  it('strictly skips expired items that have an active legal hold', async () => {
    const actor = {
      user_id: 'usr_apex_mgr_02',
      email: 'priya.sharma@apexhealth.example',
      role: 'case_manager' as any,
      ip_address: '127.0.0.1'
    };

    const item = await evidenceService.uploadEvidence(
      'org_apex_health_01',
      'case_apex_2026_001',
      {
        originalFilename: 'held_expired_item.png',
        declaredMimeType: 'image/png',
        fileBuffer: Buffer.concat([pngHeader, Buffer.from('HELD_EXPIRED_DATA')]),
        safeDisplayName: 'Held Expired Item'
      },
      actor
    );

    // Place legal hold
    evidenceService.placeLegalHold('org_apex_health_01', item.id, 'Court ordered hold', actor);

    // Set retention_until to the past
    const past = new Date(Date.now() - 100000).toISOString();
    testDb
      .prepare('UPDATE evidence_items SET retention_until = ? WHERE id = ?')
      .run(past, item.id);

    // Run retention purge
    const result = await retentionService.purgeExpiredEvidence({
      dryRun: false,
      organizationId: 'org_apex_health_01'
    });

    expect(result.skippedOnHold).toBeGreaterThanOrEqual(1);
    expect(result.purgedEvidenceIds).not.toContain(item.id);

    // File MUST NOT be deleted
    expect(await inMemoryStorage.exists(item.storage_key)).toBe(true);

    // Status MUST remain available
    const dbItem = testDb
      .prepare('SELECT status, legal_hold FROM evidence_items WHERE id = ?')
      .get(item.id) as any;

    expect(dbItem.status).toBe('available');
    expect(dbItem.legal_hold).toBe(1);
  });
});
