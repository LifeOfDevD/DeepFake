import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { UsageMeteringService } from '../../src/services/usage-metering-service.js';

describe('Unit: Usage Metering Service', () => {
  let db: any;
  let service: UsageMeteringService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    service = new UsageMeteringService();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('records raw usage events idempotently', () => {
    const event1 = service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'submission_simulated',
      quantity: 1,
      idempotency_key: 'test_sub_sim_001',
      resource_id: 'sub_001'
    });

    expect(event1.id).toBeDefined();
    expect(event1.quantity).toBe(1);

    // Re-recording with identical idempotency_key returns existing without creating new row
    const event2 = service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'submission_simulated',
      quantity: 1,
      idempotency_key: 'test_sub_sim_001',
      resource_id: 'sub_001'
    });

    expect(event2.id).toBe(event1.id);

    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events WHERE idempotency_key = ?').get('test_sub_sim_001') as any).c;
    expect(count).toBe(1);
  });

  it('updates daily aggregates on event recording and retrieves them', () => {
    const today = new Date().toISOString().slice(0, 10);
    service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'case_created',
      quantity: 1,
      idempotency_key: 'agg_test_01'
    });
    service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'case_created',
      quantity: 2,
      idempotency_key: 'agg_test_02'
    });

    const aggregates = service.getDailyAggregates('org_apex_health_01');
    expect(aggregates.length).toBeGreaterThan(0);

    const caseCreatedAgg = aggregates.find((a) => a.event_type === 'case_created' && a.date === today);
    expect(caseCreatedAgg).toBeDefined();
    expect(caseCreatedAgg!.total_quantity).toBeGreaterThanOrEqual(3);
  });

  it('calculates itemized usage summary across metric categories', () => {
    service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'case_created',
      quantity: 4,
      idempotency_key: 'summary_test_01'
    });

    const summary = service.getUsageSummary('org_apex_health_01');
    expect(summary.case_created).toBeGreaterThanOrEqual(4);
    expect(typeof summary.submission_simulated).toBe('number');
    expect(typeof summary.evidence_bytes_stored).toBe('number');
  });

  it('exports usage in CSV and JSON formats', () => {
    service.recordEvent({
      organization_id: 'org_apex_health_01',
      event_type: 'case_created',
      quantity: 1,
      idempotency_key: 'export_test_01'
    });

    const jsonExport = service.exportUsage('org_apex_health_01', 'json');
    expect(typeof jsonExport).toBe('string');
    const parsed = JSON.parse(jsonExport);
    expect(Array.isArray(parsed)).toBe(true);

    const csvExport = service.exportUsage('org_apex_health_01', 'csv');
    expect(typeof csvExport).toBe('string');
    expect(csvExport).toContain('date,organization_id,event_type,total_quantity');
    expect(csvExport).toContain('case_created');
  });

  it('records administrative usage adjustments with audit metadata', () => {
    const actor = {
      user_id: 'usr_sysadmin_00',
      email: 'sysadmin@desk.example',
      role: 'system_admin' as any
    };

    service.recordAdjustment(
      'org_apex_health_01',
      {
        event_type: 'submission_simulated',
        quantity_delta: -5,
        reason: 'Monthly pilot reconciliation credit'
      },
      actor
    );

    const adj = db.prepare('SELECT * FROM usage_adjustments WHERE organization_id = ?').get('org_apex_health_01') as any;
    expect(adj).toBeDefined();
    expect(adj.quantity_delta).toBe(-5);
    expect(adj.reason).toContain('Monthly pilot reconciliation credit');
    expect(adj.adjusted_by_user_id).toBe('usr_sysadmin_00');
  });
});
