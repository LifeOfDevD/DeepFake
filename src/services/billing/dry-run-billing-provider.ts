import Database from 'better-sqlite3';
import crypto from 'crypto';
import { getDatabase } from '../../db/connection.js';
import { getPlanDefinition, listAvailablePlans, PlanDefinition } from '../../config/plans.js';
import {
  BillingCustomer,
  BillingCustomerInput,
  BillingSubscription,
  BillingSubscriptionInput,
  InvoiceItemLine,
  InvoicePreview,
  InvoicePreviewInput
} from '../../domain/types.js';
import { EntitlementService } from '../entitlement-service.js';
import { UsageMeteringService } from '../usage-metering-service.js';

export interface UsageRecord {
  organizationId: string;
  metric: string;
  quantity: number;
  timestamp?: string;
}

export interface BillingProvider {
  createCustomer(input: BillingCustomerInput): Promise<BillingCustomer>;
  createSubscription(input: BillingSubscriptionInput): Promise<BillingSubscription>;
  recordUsage(input: UsageRecord): Promise<void>;
  generateInvoicePreview(input: InvoicePreviewInput): Promise<InvoicePreview>;
}

export class LocalDryRunBillingProvider implements BillingProvider {
  private entitlementService: EntitlementService;
  private usageService: UsageMeteringService;

  constructor(private db: Database.Database = getDatabase()) {
    this.entitlementService = new EntitlementService(this.db);
    this.usageService = new UsageMeteringService(this.db);
  }

  /**
   * Deterministically generates mock customer records (zero external calls)
   */
  public async createCustomer(input: BillingCustomerInput): Promise<BillingCustomer> {
    const hash = crypto.createHash('sha256').update(input.organizationId).digest('hex').slice(0, 10);
    const customerId = `CUST-SIM-${hash.toUpperCase()}`;

    return {
      customerId,
      organizationId: input.organizationId,
      name: input.name,
      email: input.email,
      mode: 'DRY_RUN',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Deterministically creates mock subscription
   */
  public async createSubscription(input: BillingSubscriptionInput): Promise<BillingSubscription> {
    const hash = crypto.createHash('sha256').update(`${input.organizationId}:${input.planTier}`).digest('hex').slice(0, 10);
    const subscriptionId = `SUB-SIM-${hash.toUpperCase()}`;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      subscriptionId,
      customerId: input.customerId,
      organizationId: input.organizationId,
      planTier: input.planTier,
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      mode: 'DRY_RUN'
    };
  }

  /**
   * Records metered usage in dry-run mode
   */
  public async recordUsage(input: UsageRecord): Promise<void> {
    const nowIso = input.timestamp || new Date().toISOString();
    const idempotencyKey = `bill_meter_${input.organizationId}_${input.metric}_${nowIso}`;

    this.usageService.recordEvent({
      organization_id: input.organizationId,
      event_type: input.metric as any,
      quantity: input.quantity,
      idempotency_key: idempotencyKey
    });
  }

  /**
   * Calculates plan fee + metered usage overages and renders invoice preview
   */
  public async generateInvoicePreview(input: InvoicePreviewInput): Promise<InvoicePreview> {
    const org = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(input.organizationId) as any;
    if (!org) {
      throw new Error(`Organization '${input.organizationId}' not found.`);
    }

    const entitlements = this.entitlementService.getEntitlements(input.organizationId);
    const plan = getPlanDefinition(entitlements.plan_tier);

    const now = new Date();
    const monthKey = input.monthString || now.toISOString().slice(0, 7); // YYYY-MM
    const startDate = `${monthKey}-01`;
    const endDate = `${monthKey}-31`;

    const usage = this.usageService.getUsageSummary(input.organizationId, startDate, endDate);

    const lineItems: InvoiceItemLine[] = [];
    const overageWarnings: string[] = [];

    // Base Plan Subscription
    lineItems.push({
      description: `${plan.name} Subscription (Base Tier)`,
      quantity: 1,
      unitPriceInr: plan.basePriceInr,
      amountInr: plan.basePriceInr,
      isOverage: false
    });

    let subtotalInr = plan.basePriceInr;

    // Check Case Overages
    const activeCases = usage.case_created || 0;
    if (activeCases > plan.limits.maxActiveCases) {
      const excess = activeCases - plan.limits.maxActiveCases;
      const amount = excess * plan.overageRates.perAdditionalCaseInr;
      subtotalInr += amount;
      lineItems.push({
        description: `Additional Cases (${excess} over plan limit of ${plan.limits.maxActiveCases})`,
        quantity: excess,
        unitPriceInr: plan.overageRates.perAdditionalCaseInr,
        amountInr: amount,
        isOverage: true
      });
      overageWarnings.push(`Exceeded case limit by ${excess} cases.`);
    }

    // Check Upload Overages
    const uploads = usage.evidence_uploaded || 0;
    if (uploads > plan.limits.maxMonthlyEvidenceUploads) {
      const excess = uploads - plan.limits.maxMonthlyEvidenceUploads;
      overageWarnings.push(`Exceeded monthly evidence uploads by ${excess}.`);
    }

    // Check Storage Overages
    const currentBytes = (
      this.db
        .prepare("SELECT COALESCE(SUM(byte_size), 0) as total FROM evidence_items WHERE organization_id = ? AND status != 'deleted'")
        .get(input.organizationId) as { total: number }
    ).total;

    if (currentBytes > plan.limits.maxStorageBytes) {
      const excessBytes = currentBytes - plan.limits.maxStorageBytes;
      const excessGb = Math.ceil(excessBytes / (1024 * 1024 * 1024));
      const amount = excessGb * plan.overageRates.perAdditionalGigabyteInr;
      subtotalInr += amount;
      lineItems.push({
        description: `Additional Storage (${excessGb} GB over plan allowance)`,
        quantity: excessGb,
        unitPriceInr: plan.overageRates.perAdditionalGigabyteInr,
        amountInr: amount,
        isOverage: true
      });
      overageWarnings.push(`Storage consumption is ${excessGb} GB above plan quota.`);
    }

    // Check Simulation Overages
    const simulations = usage.submission_simulated || 0;
    if (simulations > plan.limits.maxSimulatedSubmissionsPerMonth) {
      const excess = simulations - plan.limits.maxSimulatedSubmissionsPerMonth;
      const amount = excess * plan.overageRates.perAdditionalSimulationInr;
      subtotalInr += amount;
      lineItems.push({
        description: `Additional Simulated Platform Dispatches (${excess} over allowance)`,
        quantity: excess,
        unitPriceInr: plan.overageRates.perAdditionalSimulationInr,
        amountInr: amount,
        isOverage: true
      });
      overageWarnings.push(`Exceeded simulated submission limit by ${excess} dispatches.`);
    }

    // 18% GST calculation (Standard for Indian SaaS B2B)
    const gstInr = Math.round(subtotalInr * 0.18);
    const totalInr = subtotalInr + gstInr;

    const hash = crypto.createHash('sha256').update(`${input.organizationId}:${monthKey}:${subtotalInr}`).digest('hex').slice(0, 8);
    const invoiceNumber = `INV-SIM-${monthKey.replace('-', '')}-${hash.toUpperCase()}`;

    return {
      invoiceNumber,
      organizationId: input.organizationId,
      organizationName: org.name,
      periodStart: `${startDate}T00:00:00Z`,
      periodEnd: `${endDate}T23:59:59Z`,
      planTier: entitlements.plan_tier,
      subtotalInr,
      gstInr,
      totalInr,
      lineItems,
      overageWarnings,
      mode: 'DRY_RUN_SIMULATION_ONLY',
      watermark: 'DRY-RUN SIMULATION ONLY - NO PAYMENT PROCESSED - ZERO COMMERCIAL CHARGES',
      generatedAt: now.toISOString()
    };
  }

  public listPlans(): PlanDefinition[] {
    return listAvailablePlans();
  }

  public async previewUpcomingInvoice(organizationId: string): Promise<InvoicePreview> {
    return this.generateInvoicePreview({ organizationId });
  }

  public async getOrCreateCustomer(organizationId: string): Promise<BillingCustomer> {
    const org = this.db.prepare('SELECT name, primary_contact_email, jurisdiction FROM organizations WHERE id = ?').get(organizationId) as any;
    return this.createCustomer({
      organizationId,
      name: org?.name || 'Customer Organization',
      email: org?.primary_contact_email || 'billing@example.com',
      jurisdiction: org?.jurisdiction || 'IN-DL'
    });
  }

  public async getSubscription(organizationId: string): Promise<BillingSubscription> {
    const customer = await this.getOrCreateCustomer(organizationId);
    const entitlements = this.entitlementService.getEntitlements(organizationId);
    return this.createSubscription({
      organizationId,
      customerId: customer.customerId,
      planTier: entitlements.plan_tier
    });
  }
}
