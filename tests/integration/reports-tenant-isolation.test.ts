import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Integration: Customer Operational Reports & Multi-Tenant Isolation', () => {
  let app: any;
  let db: any;

  const REPORT_TYPES = [
    'open_cases',
    'statutory_clocks_overdue',
    'active_escalations',
    'evidence_inventory',
    'retention_schedule',
    'submission_simulation_history',
    'response_outcomes',
    'usage_summary',
    'audit_timeline'
  ];

  beforeAll(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('lists all 9 customer operational report types', async () => {
    const res = await request(app)
      .get('/api/reports/types')
      .set('x-organization-id', 'org_apex_health_01')
      .set('x-user-id', 'usr_apex_mgr_02');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(9);
    for (const type of REPORT_TYPES) {
      expect(res.body.data.some((r: any) => r.type === type)).toBe(true);
    }
  });

  for (const reportType of REPORT_TYPES) {
    it(`generates report '${reportType}' strictly scoped to tenant data (zero cross-tenant leakage)`, async () => {
      const res = await request(app)
        .post('/api/reports/generate')
        .set('x-organization-id', 'org_apex_health_01')
        .set('x-user-id', 'usr_apex_mgr_02')
        .send({
          report_type: reportType,
          format: 'json'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reportType).toBe(reportType);

      const rows = res.body.data.data;
      expect(Array.isArray(rows)).toBe(true);

      // Verify no records from org_bharatfin_02 appear in any returned field
      for (const row of rows) {
        const rowStr = JSON.stringify(row);
        expect(rowStr).not.toContain('org_bharatfin_02');
        expect(rowStr).not.toContain('BharatFin');
      }
    });

    it(`exports report '${reportType}' as CSV with tenant isolation`, async () => {
      const res = await request(app)
        .post('/api/reports/generate')
        .set('x-organization-id', 'org_apex_health_01')
        .set('x-user-id', 'usr_apex_mgr_02')
        .send({
          report_type: reportType,
          format: 'csv'
        });

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.text).not.toContain('org_bharatfin_02');
      expect(res.text).not.toContain('BharatFin');
    });
  }
});
