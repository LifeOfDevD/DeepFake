import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Customer Onboarding & Organization Lifecycle', () => {
  let app: any;
  let db: any;

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('creates a new organization with designated plan tier and initializes entitlements', async () => {
    const res = await request(app)
      .post('/api/onboarding/organizations')
      .set('x-user-id', 'usr_sysadmin_00')
      .send({
        name: 'Kavach Cybersecurity Solutions',
        slug: 'kavach-cyber',
        industry: 'Cybersecurity & Incident Response',
        jurisdiction: 'IN-DL',
        primary_contact_email: 'ops@kavach.example',
        grievance_officer_name: 'Vikram Malhotra',
        grievance_officer_email: 'grievance@kavach.example',
        plan_tier: 'pilot'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('onboarding');

    const orgId = res.body.data.id;

    // Verify entitlements were automatically seeded
    const ent = db.prepare('SELECT plan_tier FROM pilot_entitlements WHERE organization_id = ?').get(orgId) as any;
    expect(ent).toBeDefined();
    expect(ent.plan_tier).toBe('pilot');
  });

  it('tracks 7-step onboarding readiness checklist', async () => {
    const res = await request(app)
      .get('/api/onboarding/checklist')
      .set('x-organization-id', 'org_apex_health_01')
      .set('x-user-id', 'usr_apex_owner_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const status = res.body.data;
    expect(Object.keys(status.checklist).length).toBe(7);
    expect(typeof status.isComplete).toBe('boolean');
    expect(status.checklist.profile_complete).toBe(true);
  });

  it('issues invitation with single-use cryptographic token', async () => {
    const res = await request(app)
      .post('/api/onboarding/invitations')
      .set('x-organization-id', 'org_apex_health_01')
      .set('x-user-id', 'usr_apex_owner_01')
      .send({
        email: 'priya.legal@apexhealth.example',
        role: 'legal_reviewer'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invitationToken).toBeDefined();
    expect(res.body.data.invitation.status).toBe('pending');

    const token = res.body.data.invitationToken;

    // Accept invitation
    const acceptRes = await request(app)
      .post('/api/onboarding/invitations/accept')
      .send({
        token,
        full_name: 'Priya Sundaram',
        password: 'SecurePassword123!'
      });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.success).toBe(true);
    expect(acceptRes.body.data.fullName).toBe('Priya Sundaram');

    // Token cannot be reused (single-use constraint)
    const reuseRes = await request(app)
      .post('/api/onboarding/invitations/accept')
      .send({
        token,
        full_name: 'Priya Sundaram',
        password: 'AnotherPassword123!'
      });

    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.success).toBe(false);
  });

  it('soft-deactivates an organization while retaining chain-of-custody evidence', async () => {
    // Insert evidence item to verify retention upon offboarding
    db.prepare(`
      INSERT INTO evidence_items (
        id, organization_id, case_id, evidence_type, original_filename, safe_display_name,
        mime_type, detected_mime_type, byte_size, sha256, storage_key, status, sensitivity,
        uploaded_by, retention_until
      ) VALUES (
        'ev_bf_test_01', 'org_bharatfin_02', 'case_bharatfin_2026_003', 'screenshot',
        'proof.png', 'proof.png', 'image/png', 'image/png', 1024,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'key_bf_01',
        'available', 'normal', 'usr_sysadmin_00', datetime('now', '+180 days')
      )
    `).run();

    // Suspend org via admin endpoint
    const suspendRes = await request(app)
      .post('/api/admin/organizations/org_bharatfin_02/suspend')
      .set('x-user-id', 'usr_sysadmin_00')
      .send({ reason: 'Pilot phase completed' });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.success).toBe(true);
    expect(suspendRes.body.data.status).toBe('suspended');

    // Offboard org
    const offboardRes = await request(app)
      .post('/api/admin/organizations/org_bharatfin_02/offboard')
      .set('x-user-id', 'usr_sysadmin_00')
      .send({ reason: 'Contractual conclusion' });

    expect(offboardRes.status).toBe(200);
    expect(offboardRes.body.success).toBe(true);
    expect(offboardRes.body.data.status).toBe('deactivated');

    // Evidence items and audit logs MUST remain in the database for chain of custody
    const evidenceCount = (db.prepare('SELECT COUNT(*) as c FROM evidence_items WHERE organization_id = ?').get('org_bharatfin_02') as any).c;
    expect(evidenceCount).toBeGreaterThan(0);

    const auditCount = (db.prepare('SELECT COUNT(*) as c FROM audit_events WHERE organization_id = ?').get('org_bharatfin_02') as any).c;
    expect(auditCount).toBeGreaterThan(0);
  });
});
