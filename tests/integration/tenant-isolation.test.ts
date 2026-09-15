import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Multi-Tenant Data Isolation', () => {
  let app: any;

  beforeAll(() => {
    // Use an isolated in-memory DB for test hermeticity
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('allows User A to access their own organization cases', async () => {
    // User A belongs to org_apex_health_01
    const res = await request(app)
      .get('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // All returned cases must have organization_id === 'org_apex_health_01'
    for (const c of res.body.data) {
      expect(c.organization_id).toBe('org_apex_health_01');
    }
  });

  it('forbids User A from querying Organization B with 403 Forbidden', async () => {
    // User A (Apex) attempts to pass BharatFin org ID
    const res = await request(app)
      .get('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_bharatfin_02');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('prevents cross-tenant access to individual case details (returns 404)', async () => {
    // case_bharatfin_2026_003 belongs to org_bharatfin_02.
    // User A in org_apex_health_01 queries it directly.
    const res = await request(app)
      .get('/api/cases/case_bharatfin_2026_003')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('prevents cross-tenant mutation of case status', async () => {
    // User A in org_apex_health_01 attempts to mutate case belonging to BharatFin
    const res = await request(app)
      .patch('/api/cases/case_bharatfin_2026_003/status')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        to_status: 'rejected',
        reason: 'Malicious cross-tenant attempt'
      });

    expect(res.status).toBe(404);
  });
});
