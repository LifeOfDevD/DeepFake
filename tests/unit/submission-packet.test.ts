import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { SubmissionPacketService } from '../../src/services/submission-packet-service.js';
import { Case } from '../../src/domain/types.js';

describe('Phase 3 Unit Test: Submission Packet & Notice Service', () => {
  let db: Database.Database;
  let packetService: SubmissionPacketService;
  const orgId = 'org_packet_test';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Packet Org', 'packet-org', 'Media', 'IN-DL', 'packet@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role)
      VALUES ('user_1', 'user1@example.com', 'Test User 1', 'hash', 'user')
    `).run();

    packetService = new SubmissionPacketService(db);
  });

  function createSampleCase(): Case {
    const caseData: Case = {
      id: 'case_packet_1',
      organization_id: orgId,
      case_number: 'CS-2026-701',
      title: 'Scam Endorsement Deepfake Video',
      category: 'synthetic_media_endorsement',
      priority: 'high',
      status: 'ready_for_submission',
      target_entity: 'Famous Podcaster',
      contested_url: 'https://youtube.com/watch?v=fake123',
      hosting_platform: 'YouTube',
      reported_by_email: 'agent@talent.com',
      assigned_to_user_id: null,
      requires_legal_review: 1,
      statutory_basis: JSON.stringify(['IT Rules 2021 Rule 3(2)(b)', 'Section 79 IT Act 2000']),
      selected_legal_grounds: JSON.stringify(['Section 318(4) BNS Cheating by Personation']),
      declaration_confirmed: 1,
      approval_status: 'ready_for_submission',
      harm_type: 'financial_fraud',
      suspected_synthetic_media_type: 'lip_sync_deepfake',
      impersonation_method: 'synthetic_content',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis,
        selected_legal_grounds, declaration_confirmed, approval_status,
        harm_type, suspected_synthetic_media_type, impersonation_method,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `).run(
      caseData.id,
      caseData.organization_id,
      caseData.case_number,
      caseData.title,
      caseData.category,
      caseData.priority,
      caseData.status,
      caseData.target_entity,
      caseData.contested_url,
      caseData.hosting_platform,
      caseData.reported_by_email,
      caseData.assigned_to_user_id,
      caseData.requires_legal_review,
      caseData.statutory_basis,
      caseData.selected_legal_grounds,
      caseData.declaration_confirmed,
      caseData.approval_status,
      caseData.harm_type,
      caseData.suspected_synthetic_media_type,
      caseData.impersonation_method,
      caseData.created_at,
      caseData.updated_at
    );

    // Attach available evidence item
    db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename,
        safe_display_name, mime_type, detected_mime_type, byte_size, sha256,
        storage_key, status, sensitivity, uploaded_by, retention_until,
        created_at, updated_at
      ) VALUES (
        'ev_packet_1', ?, ?, 'image', 'deepfake_screenshot.png',
        'deepfake_screenshot.png', 'image/png', 'image/png', 2048,
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
        'key_packet_1', 'available', 'normal', 'user_1', datetime('now', '+30 days'),
        datetime('now'), datetime('now')
      )
    `).run(orgId, caseData.id);

    return caseData;
  }

  it('generates deterministic dry-run submission packet with SHA-256 hash', () => {
    const c = createSampleCase();
    const packet = packetService.generatePacket(c, 'actor_user_1');

    expect(packet.id).toBeDefined();
    expect(packet.packet_version).toBe(1);
    expect(packet.status).toBe('dry_run_generated');
    expect(packet.packet_hash).toHaveLength(64);

    const payload = JSON.parse(packet.packet_json);
    expect(payload.mode).toBe('DRY_RUN_ONLY_SIMULATION');
    expect(payload.case_number).toBe(c.case_number);
    expect(payload.evidence_manifest.length).toBe(1);
    expect(payload.evidence_manifest[0].sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('formats statutory markdown takedown notice with legal citations and evidence table', () => {
    const c = createSampleCase();
    const packet = packetService.generatePacket(c, 'actor_user_1');

    const md = packet.packet_markdown;
    expect(md).toContain('STATUTORY GRIEVANCE AND INTERMEDIARY TAKEDOWN NOTICE');
    expect(md).toContain('SIMULATED PILOT SUBMISSION PACKET — DRY-RUN ONLY');
    expect(md).toContain('Section 79(3)(b) Information Technology Act, 2000');
    expect(md).toContain('deepfake_screenshot.png');
    expect(md).toContain('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(md).toContain('DRY-RUN ONLY');
  });

  it('simulates submission and records immutable audit event', () => {
    const c = createSampleCase();
    packetService.generatePacket(c, 'actor_user_1');

    const simResult = packetService.simulateSubmission(c.id, orgId, 'user_case_mgr', 'mgr@example.com');
    expect(simResult.packet.status).toBe('simulated');
    expect(simResult.simulatedAt).toBeDefined();

    // Check case approval status was updated in database
    const updatedCase = db.prepare('SELECT approval_status FROM cases WHERE id = ?').get(c.id) as { approval_status: string };
    expect(updatedCase.approval_status).toBe('submission_simulated');

    // Verify audit event
    const auditEvent = db.prepare(`
      SELECT * FROM audit_events
      WHERE organization_id = ? AND action = 'case.submission_simulated'
    `).get(orgId) as any;
    expect(auditEvent).not.toBeNull();
    expect(JSON.parse(auditEvent.details).mode).toBe('DRY_RUN_ONLY_SIMULATION');
  });
});
