import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { createSessionToken } from '../../src/middleware/auth.js';
import { setConfig, getConfig } from '../../src/config/env.js';

describe('Security: Authentication Hardening & Session Tokens', () => {
  let app: any;
  let testDb: any;
  const originalConfig = { ...getConfig() };

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    setConfig(originalConfig);
    closeDatabase();
  });

  it('authenticates successfully with a valid HMAC-signed Bearer session token', async () => {
    const token = createSessionToken({
      id: 'usr_apex_mgr_02',
      email: 'priya.sharma@apexhealth.example',
      system_role: 'user'
    });

    const res = await request(app)
      .get('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects tampered or forged Bearer tokens', async () => {
    const validToken = createSessionToken({
      id: 'usr_apex_mgr_02',
      email: 'priya.sharma@apexhealth.example',
      system_role: 'user'
    });

    // Tamper with payload
    const forgedToken = validToken.replace('desk_tok_', 'desk_tok_eyJ1c2VySWQiOiJmb3JnZWQifQ.');

    const res = await request(app)
      .get('/api/cases')
      .set('Authorization', `Bearer ${forgedToken}`)
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects expired Bearer session tokens', async () => {
    // Generate token with negative TTL (already expired)
    const expiredToken = createSessionToken(
      {
        id: 'usr_apex_mgr_02',
        email: 'priya.sharma@apexhealth.example',
        system_role: 'user'
      },
      -10 // Expired 10 seconds ago
    );

    const res = await request(app)
      .get('/api/cases')
      .set('Authorization', `Bearer ${expiredToken}`)
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('expired');
  });

  it('strictly rejects header-based auth (x-user-id) in production mode', async () => {
    // Switch to production config
    setConfig({
      ...getConfig(),
      nodeEnv: 'production'
    });

    const res = await request(app)
      .get('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('HEADER_AUTH_DISALLOWED');

    // Restore test config
    setConfig(originalConfig);
  });

  it('audits system admin cross-tenant actions when accessing an organization without membership', async () => {
    // usr_sysadmin_00 has system_role='system_admin'
    const res = await request(app)
      .get('/api/cases')
      .set('x-user-id', 'usr_sysadmin_00')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);

    // Verify audit event was recorded
    const auditRow = testDb
      .prepare(`
        SELECT * FROM audit_events
        WHERE action = 'system_admin_cross_tenant_access'
          AND organization_id = 'org_apex_health_01'
        ORDER BY created_at DESC LIMIT 1
      `)
      .get() as any;

    expect(auditRow).toBeDefined();
    expect(auditRow.actor_user_id).toBe('usr_sysadmin_00');
  });
});
