import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security: Input Validation & Injection Resistance', () => {
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

  it('rejects case creation with invalid or non-URL contested link', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01')
      .send({
        title: 'Malformed URL Case',
        category: 'scam_advertisement',
        priority: 'low',
        target_entity: 'Test Entity',
        contested_url: 'not-a-valid-http-url',
        hosting_platform: 'Meta',
        reported_by_email: 'test@example.com'
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('safely parameterizes SQL injection attempts in search queries', async () => {
    const sqlInjectionTerm = "'; DROP TABLE cases; --";
    const res = await request(app)
      .get(`/api/cases?search=${encodeURIComponent(sqlInjectionTerm)}`)
      .set('x-user-id', 'usr_apex_mgr_02')
      .set('x-organization-id', 'org_apex_health_01');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]); // No matching cases, but table remains safe

    // Verify table is not dropped
    const checkTable = testDb.prepare("SELECT COUNT(*) as count FROM cases").get();
    expect(checkTable.count).toBeGreaterThan(0);
  });

  it('safely resets demo data multiple times without constraint errors', () => {
    expect(() => {
      seedDemoData(testDb);
      seedDemoData(testDb);
    }).not.toThrow();
  });
});
