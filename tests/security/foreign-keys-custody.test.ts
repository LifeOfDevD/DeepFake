import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security & Integrity: Foreign Key Custody Restrictions (ON DELETE RESTRICT)', () => {
  let db: any;

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);

    // Insert test evidence item referencing org_apex_health_01 and case_apex_2026_001
    db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename,
        safe_display_name, mime_type, detected_mime_type, byte_size,
        sha256, storage_key, status, sensitivity, source_url,
        captured_at, uploaded_at, uploaded_by, retention_until,
        legal_hold, created_at, updated_at
      ) VALUES (
        'ev_fk_test_001', 'org_apex_health_01', 'case_apex_2026_001', 'image', 'photo.png',
        'photo.png', 'image/png', 'image/png', 1024,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'evidence/org_apex_health_01/case_apex_2026_001/ev_fk_test_001/payload.png',
        'available', 'normal', NULL,
        '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', 'usr_apex_mgr_02', '2027-03-12T12:00:00Z',
        0, '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z'
      )
    `).run();

    // Insert custody access event referencing ev_fk_test_001
    db.prepare(`
      INSERT INTO evidence_access_events (
        id, organization_id, evidence_id, actor_user_id,
        action, success, ip_address, user_agent, created_at, metadata_json
      ) VALUES (
        'ev_acc_fk_001', 'org_apex_health_01', 'ev_fk_test_001', 'usr_apex_mgr_02',
        'evidence_upload_completed', 1, '127.0.0.1', 'Vitest-Agent', '2026-09-12T12:00:00Z', '{}'
      )
    `).run();

    // Insert deletion request referencing ev_fk_test_001
    db.prepare(`
      INSERT INTO evidence_deletion_requests (
        id, organization_id, case_id, evidence_id, requested_by,
        request_reason, status, created_at, updated_at
      ) VALUES (
        'del_req_fk_001', 'org_apex_health_01', 'case_apex_2026_001', 'ev_fk_test_001', 'usr_apex_analyst_03',
        'Legal compliance review', 'pending', '2026-09-12T12:05:00Z', '2026-09-12T12:05:00Z'
      )
    `).run();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('strictly blocks deleting an organization when evidence items reference it (ON DELETE RESTRICT)', () => {
    expect(() => {
      db.prepare("DELETE FROM organizations WHERE id = 'org_apex_health_01'").run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('strictly blocks deleting a case when evidence items reference it (ON DELETE RESTRICT)', () => {
    expect(() => {
      db.prepare("DELETE FROM cases WHERE id = 'case_apex_2026_001'").run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('strictly blocks deleting an evidence item when chain-of-custody audit records reference it (ON DELETE RESTRICT)', () => {
    expect(() => {
      db.prepare("DELETE FROM evidence_items WHERE id = 'ev_fk_test_001'").run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('strictly blocks inserting evidence access events with non-existent evidence IDs', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO evidence_access_events (
          id, organization_id, evidence_id, actor_user_id,
          action, success, ip_address, user_agent, created_at, metadata_json
        ) VALUES (
          'ev_acc_orphan_999', 'org_apex_health_01', 'non_existent_ev_999', 'usr_apex_mgr_02',
          'file_downloaded', 1, '127.0.0.1', 'Vitest-Agent', '2026-09-12T12:00:00Z', '{}'
        )
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('strictly blocks inserting deletion requests with non-existent case or evidence IDs', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO evidence_deletion_requests (
          id, organization_id, case_id, evidence_id, requested_by,
          request_reason, status, created_at, updated_at
        ) VALUES (
          'del_req_orphan_999', 'org_apex_health_01', 'non_existent_case_999', 'ev_fk_test_001', 'usr_apex_mgr_02',
          'Test', 'pending', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z'
        )
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });
});
