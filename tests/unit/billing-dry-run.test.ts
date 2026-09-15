import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { LocalDryRunBillingProvider } from '../../src/services/billing/dry-run-billing-provider.js';

describe('Unit: Local Dry-Run Billing Provider', () => {
  let db: any;
  let provider: LocalDryRunBillingProvider;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    provider = new LocalDryRunBillingProvider();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('lists all plan tiers with limits and overage schedules', () => {
    const plans = provider.listPlans();
    expect(plans.length).toBe(3);

    const pilot = plans.find((p) => p.id === 'pilot');
    expect(pilot).toBeDefined();
    expect(pilot!.basePriceInr).toBe(0);
    expect(pilot!.limits.maxActiveCases).toBe(25);
    expect(pilot!.overageRates.perAdditionalCaseInr).toBe(0);

    const pro = plans.find((p) => p.id === 'professional');
    expect(pro!.basePriceInr).toBe(49000);

    const enterprise = plans.find((p) => p.id === 'enterprise');
    expect(enterprise!.basePriceInr).toBe(149000);
  });

  it('generates simulated invoice preview with base fee, 18% GST, and watermark', async () => {
    const preview = await provider.previewUpcomingInvoice('org_apex_health_01');

    expect(preview.invoiceNumber).toMatch(/^INV-SIM-/);
    expect(preview.planTier).toBe('pilot');
    expect(preview.subtotalInr).toBeGreaterThanOrEqual(0);

    // Verify 18% GST calculation
    const expectedGst = Math.round(preview.subtotalInr * 0.18);
    expect(preview.gstInr).toBe(expectedGst);
    expect(preview.totalInr).toBe(preview.subtotalInr + expectedGst);

    // Verify dry run watermark disclaimer
    expect(preview.watermark).toContain('DRY-RUN SIMULATION ONLY');
    expect(preview.mode).toBe('DRY_RUN_SIMULATION_ONLY');

    // Verify line items include plan base subscription
    const baseItem = preview.lineItems.find((li) => li.description.includes('Subscription'));
    expect(baseItem).toBeDefined();
    expect(baseItem!.amountInr).toBe(0);
  });

  it('calculates metered overages on high-usage organizations', async () => {
    // Record simulated case creation aggregates to exceed pilot limit (25)
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO usage_daily_aggregates (id, organization_id, date, event_type, total_quantity, updated_at)
      VALUES (?, ?, ?, 'case_created', 30, datetime('now'))
    `).run('mock_agg_overage', 'org_apex_health_01', today);

    const preview = await provider.previewUpcomingInvoice('org_apex_health_01');
    expect(preview.overageWarnings.length).toBeGreaterThan(0);
  });

  it('creates and returns deterministic simulated customer profile', async () => {
    const customer = await provider.getOrCreateCustomer('org_apex_health_01');
    expect(customer.customerId).toMatch(/^CUST-SIM-/);
    expect(customer.organizationId).toBe('org_apex_health_01');

    const subscription = await provider.getSubscription('org_apex_health_01');
    expect(subscription).toBeDefined();
    expect(subscription!.planTier).toBe('pilot');
    expect(subscription!.status).toBe('active');
  });
});
