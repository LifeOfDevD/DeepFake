import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { TenantService } from '../../src/services/tenant-service.js';

describe('Integration: Audit Trail Integrity & Immutability', () => {
  let app: any;
  let testDb: any;

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('records an immutable audit event upon case creation', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        title: 'Audit Verification Incident',
        category: 'fake_support_account',
        priority: 'high',
        target_entity: 'Apex Verification',
        contested_url: 'https://test.example/audit-fake',
        hosting_platform: 'WhatsApp',
        reported_by_email: 'audit@apexhealth.example'
      });

    expect(res.status).toBe(201);
    const caseId = res.body.data.id;
    const createdAt = res.body.data.created_at;

    expect(createdAt).toBeDefined();

    // Query audit_events directly
    const auditRecord = testDb
      .prepare("SELECT * FROM audit_events WHERE resource_id = ? AND action = 'case.created'")
      .get(caseId) as any;

    expect(auditRecord).toBeDefined();
    expect(auditRecord.actor_user_id).toBe('usr_apex_mgr_02');
    expect(auditRecord.organization_id).toBe('org_apex_health_01');

    const details = JSON.parse(auditRecord.details);
    expect(details.title).toBe('Audit Verification Incident');
  });

  it('records audit events for every status transition with actor and reason', async () => {
    const caseId = 'case_apex_2026_002'; // existing case at 'triage'

    const res = await request(app)
      .patch(`/api/cases/${caseId}/status`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        to_status: 'awaiting_authority',
        reason: 'Contacting legal authority representative'
      });

    expect(res.status).toBe(200);

    const auditRecord = testDb
      .prepare(`
        SELECT * FROM audit_events
        WHERE resource_id = ? AND action = 'case.status_changed'
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(caseId) as any;

    expect(auditRecord).toBeDefined();
    const details = JSON.parse(auditRecord.details);
    expect(details.previous_status).toBe('triage');
    expect(details.new_status).toBe('awaiting_authority');
    expect(details.reason).toBe('Contacting legal authority representative');
  });

  it('retains historical audit records intact when a user is deleted', async () => {
    const tenantService = new TenantService(testDb);

    // Verify existing audit records authored by usr_apex_analyst_03
    const priorAudits = testDb
      .prepare("SELECT COUNT(*) as count FROM audit_events WHERE actor_user_id = 'usr_apex_analyst_03'")
      .get() as { count: number };

    expect(priorAudits.count).toBeGreaterThan(0);

    // Delete user safely
    tenantService.deleteUserSafely('usr_apex_analyst_03');

    // Verify user is gone
    const userRow = testDb.prepare("SELECT * FROM users WHERE id = 'usr_apex_analyst_03'").get();
    expect(userRow).toBeUndefined();

    // Verify audit logs STILL exist with historical actor details
    const postDeleteAudits = testDb
      .prepare("SELECT COUNT(*) as count FROM audit_events WHERE actor_user_id = 'usr_apex_analyst_03'")
      .get() as { count: number };

    expect(postDeleteAudits.count).toBe(priorAudits.count);
  });
});
