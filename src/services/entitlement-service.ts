import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  ALL_FEATURE_FLAGS,
  FeatureFlagKey,
  getPlanDefinition
} from '../config/plans.js';
import {
  PilotEntitlementsRecord,
  PlanTier,
  UpdateEntitlementsInput
} from '../domain/types.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';

export class EntitlementError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode = 403) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class EntitlementService {
  private auditService: AuditService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
  }

  /**
   * Initializes default entitlements for an organization
   */
  public initializeDefaultEntitlements(organizationId: string, planTier: PlanTier = 'pilot'): PilotEntitlementsRecord {
    const plan = getPlanDefinition(planTier);
    const now = new Date();
    const endDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days pilot

    const id = `ent_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = now.toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO pilot_entitlements (
        id, organization_id, plan_tier, pilot_start_date, pilot_end_date,
        enabled_features, max_users, max_active_cases, max_monthly_evidence_uploads,
        max_storage_bytes, max_simulated_submissions_per_month, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        plan_tier = excluded.plan_tier,
        enabled_features = excluded.enabled_features,
        max_users = excluded.max_users,
        max_active_cases = excluded.max_active_cases,
        max_monthly_evidence_uploads = excluded.max_monthly_evidence_uploads,
        max_storage_bytes = excluded.max_storage_bytes,
        max_simulated_submissions_per_month = excluded.max_simulated_submissions_per_month,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      id,
      organizationId,
      plan.id,
      nowIso,
      endDate.toISOString(),
      JSON.stringify(plan.enabledFeatures),
      plan.limits.maxUsers,
      plan.limits.maxActiveCases,
      plan.limits.maxMonthlyEvidenceUploads,
      plan.limits.maxStorageBytes,
      plan.limits.maxSimulatedSubmissionsPerMonth,
      nowIso,
      nowIso
    );

    return this.getEntitlements(organizationId);
  }

  /**
   * Retrieves active entitlements for an organization
   */
  public getEntitlements(organizationId: string): PilotEntitlementsRecord {
    const row = this.db.prepare('SELECT * FROM pilot_entitlements WHERE organization_id = ?').get(organizationId) as any;

    if (!row) {
      return this.initializeDefaultEntitlements(organizationId);
    }

    return {
      ...row,
      enabled_features: JSON.parse(row.enabled_features || '[]')
    };
  }

  /**
   * Checks if a specific feature is enabled and not expired
   */
  public hasFeature(organizationId: string, feature: FeatureFlagKey): boolean {
    const entitlements = this.getEntitlements(organizationId);
    const now = new Date().toISOString();

    if (entitlements.pilot_end_date < now) {
      return false; // Pilot period has ended
    }

    return entitlements.enabled_features.includes(feature);
  }

  /**
   * Returns a map of all known feature flags and their enabled status for the organization
   */
  public getFeatureFlags(organizationId: string): Record<string, boolean> {
    const entitlements = this.getEntitlements(organizationId);
    const flags: Record<string, boolean> = {};
    for (const f of ALL_FEATURE_FLAGS) {
      flags[f] = entitlements.enabled_features.includes(f);
    }
    return flags;
  }

  /**
   * Asserts feature is enabled, throwing 403 if not
   */
  public assertFeatureEnabled(organizationId: string, feature: FeatureFlagKey): void {
    if (!this.hasFeature(organizationId, feature)) {
      throw new EntitlementError(
        'FEATURE_DISABLED',
        `The feature '${feature}' is not enabled for your organization plan or the pilot period has expired.`,
        403
      );
    }
  }

  /**
   * Checks usage against configured limits
   */
  public checkLimit(
    organizationId: string,
    limitKey: 'users' | 'active_cases' | 'monthly_uploads' | 'storage_bytes' | 'monthly_simulations',
    increment = 1
  ): { allowed: boolean; current: number; max: number; remaining: number } {
    const entitlements = this.getEntitlements(organizationId);
    let current = 0;
    let max = 0;

    switch (limitKey) {
      case 'users': {
        const row = this.db
          .prepare('SELECT COUNT(*) as count FROM memberships WHERE organization_id = ?')
          .get(organizationId) as { count: number };
        current = row.count;
        max = entitlements.max_users;
        break;
      }
      case 'active_cases': {
        const row = this.db
          .prepare("SELECT COUNT(*) as count FROM cases WHERE organization_id = ? AND status != 'closed'")
          .get(organizationId) as { count: number };
        current = row.count;
        max = entitlements.max_active_cases;
        break;
      }
      case 'monthly_uploads': {
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1);
        firstDayOfMonth.setHours(0, 0, 0, 0);

        const row = this.db
          .prepare(`
            SELECT COUNT(*) as count FROM usage_events
            WHERE organization_id = ? AND event_type = 'evidence_uploaded' AND recorded_at >= ?
          `)
          .get(organizationId, firstDayOfMonth.toISOString()) as { count: number };
        current = row.count;
        max = entitlements.max_monthly_evidence_uploads;
        break;
      }
      case 'storage_bytes': {
        const row = this.db
          .prepare(`
            SELECT COALESCE(SUM(byte_size), 0) as total FROM evidence_items
            WHERE organization_id = ? AND status != 'deleted'
          `)
          .get(organizationId) as { total: number };
        current = row.total;
        max = entitlements.max_storage_bytes;
        break;
      }
      case 'monthly_simulations': {
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1);
        firstDayOfMonth.setHours(0, 0, 0, 0);

        const row = this.db
          .prepare(`
            SELECT COUNT(*) as count FROM usage_events
            WHERE organization_id = ? AND event_type = 'submission_simulated' AND recorded_at >= ?
          `)
          .get(organizationId, firstDayOfMonth.toISOString()) as { count: number };
        current = row.count;
        max = entitlements.max_simulated_submissions_per_month;
        break;
      }
    }

    const remaining = Math.max(0, max - current);
    const allowed = current + increment <= max;

    return { allowed, current, max, remaining };
  }

  public assertCanCreateCase(organizationId: string): void {
    const check = this.checkLimit(organizationId, 'active_cases', 1);
    if (!check.allowed) {
      throw new EntitlementError(
        'PLAN_LIMIT_EXCEEDED',
        `Cannot create new case: organization has reached its maximum allowance of active cases (${check.current}/${check.max}).`,
        422
      );
    }
  }

  public assertCanUploadEvidence(organizationId: string, byteSize: number): void {
    this.assertFeatureEnabled(organizationId, 'evidence_locker');

    const uploadCheck = this.checkLimit(organizationId, 'monthly_uploads', 1);
    if (!uploadCheck.allowed) {
      throw new EntitlementError(
        'PLAN_LIMIT_EXCEEDED',
        `Monthly evidence upload allowance reached (${uploadCheck.current}/${uploadCheck.max}). Upgrade plan or wait for billing cycle reset.`,
        422
      );
    }

    const storageCheck = this.checkLimit(organizationId, 'storage_bytes', byteSize);
    if (!storageCheck.allowed) {
      const mbCurrent = (storageCheck.current / (1024 * 1024)).toFixed(1);
      const mbMax = (storageCheck.max / (1024 * 1024)).toFixed(1);
      throw new EntitlementError(
        'PLAN_LIMIT_EXCEEDED',
        `Storage capacity exceeded: current storage is ${mbCurrent} MB of ${mbMax} MB limit.`,
        422
      );
    }
  }

  public assertCanSimulateSubmission(organizationId: string): void {
    this.assertFeatureEnabled(organizationId, 'dry_run_submissions');

    const check = this.checkLimit(organizationId, 'monthly_simulations', 1);
    if (!check.allowed) {
      throw new EntitlementError(
        'PLAN_LIMIT_EXCEEDED',
        `Monthly simulated submission allowance reached (${check.current}/${check.max}).`,
        422
      );
    }
  }

  public assertCanInviteUser(organizationId: string): void {
    const check = this.checkLimit(organizationId, 'users', 1);
    if (!check.allowed) {
      throw new EntitlementError(
        'PLAN_LIMIT_EXCEEDED',
        `Cannot invite user: organization has reached its maximum seat allowance (${check.current}/${check.max}).`,
        422
      );
    }
  }

  /**
   * Administrator method to update entitlements
   */
  public updateEntitlements(
    organizationId: string,
    updates: UpdateEntitlementsInput,
    actor: ActorContext
  ): PilotEntitlementsRecord {
    if (actor.role !== 'system_admin' && actor.role !== 'org_owner') {
      throw new EntitlementError('ROLE_UNAUTHORIZED', 'Only System Administrators or Owners can modify entitlements.', 403);
    }

    const current = this.getEntitlements(organizationId);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE pilot_entitlements
      SET
        plan_tier = COALESCE(?, plan_tier),
        pilot_end_date = COALESCE(?, pilot_end_date),
        enabled_features = COALESCE(?, enabled_features),
        max_users = COALESCE(?, max_users),
        max_active_cases = COALESCE(?, max_active_cases),
        max_monthly_evidence_uploads = COALESCE(?, max_monthly_evidence_uploads),
        max_storage_bytes = COALESCE(?, max_storage_bytes),
        max_simulated_submissions_per_month = COALESCE(?, max_simulated_submissions_per_month),
        updated_at = ?
      WHERE organization_id = ?
    `);

    stmt.run(
      updates.plan_tier || null,
      updates.pilot_end_date || null,
      updates.enabled_features ? JSON.stringify(updates.enabled_features) : null,
      updates.max_users ?? null,
      updates.max_active_cases ?? null,
      updates.max_monthly_evidence_uploads ?? null,
      updates.max_storage_bytes ?? null,
      updates.max_simulated_submissions_per_month ?? null,
      now,
      organizationId
    );

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'entitlements.updated',
      resource_type: 'entitlements',
      resource_id: current.id,
      details: updates,
      ip_address: actor.ip_address
    });

    return this.getEntitlements(organizationId);
  }
}
