import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { AuditService } from './audit-service.js';
import { EntitlementService } from './entitlement-service.js';
import { ActorContext } from './case-service.js';
import { UpdateEntitlementsInput } from '../domain/types.js';

export interface AdminOrganizationListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: string;
  timezone: string;
  created_at: string;
  member_count: number;
  case_count: number;
}

export interface AdminOrgDetails {
  organization: Record<string, any>;
  entitlements: Record<string, any> | null;
  members: Record<string, any>[];
  activeInvitations: Record<string, any>[];
  caseStats: {
    total: number;
    open: number;
    resolved: number;
  };
}

export class PilotAdminService {
  private auditService: AuditService;
  private entitlementService: EntitlementService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
    this.entitlementService = new EntitlementService(this.db);
  }

  /**
   * List all organizations with summary metadata
   */
  public listOrganizations(): AdminOrganizationListItem[] {
    const rows = this.db
      .prepare(`
        SELECT 
          o.id,
          o.name,
          o.slug,
          o.status,
          COALESCE(pe.plan_tier, 'pilot') AS plan_tier,
          o.timezone,
          o.created_at,
          (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
          (SELECT COUNT(*) FROM cases c WHERE c.organization_id = o.id) AS case_count
        FROM organizations o
        LEFT JOIN pilot_entitlements pe ON o.id = pe.organization_id
        ORDER BY o.created_at DESC
      `)
      .all() as AdminOrganizationListItem[];

    return rows;
  }

  /**
   * Get comprehensive details for a single organization
   */
  public getOrganizationDetails(organizationId: string): AdminOrgDetails {
    const org = this.db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(organizationId) as Record<string, any>;

    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const entitlements = this.db
      .prepare('SELECT * FROM pilot_entitlements WHERE organization_id = ?')
      .get(organizationId) as Record<string, any> | undefined;

    const members = this.db
      .prepare(`
        SELECT u.id, u.email, u.full_name, m.role, u.is_active, u.status, m.created_at
        FROM memberships m
        JOIN users u ON m.user_id = u.id
        WHERE m.organization_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(organizationId) as Record<string, any>[];

    const activeInvitations = this.db
      .prepare(`
        SELECT id, email, role, status, expires_at, created_at
        FROM organization_invitations
        WHERE organization_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `)
      .all(organizationId) as Record<string, any>[];

    const totalCases = this.db
      .prepare('SELECT COUNT(*) AS count FROM cases WHERE organization_id = ?')
      .get(organizationId) as any;

    const openCases = this.db
      .prepare(`SELECT COUNT(*) AS count FROM cases WHERE organization_id = ? AND status NOT IN ('closed', 'resolved')`)
      .get(organizationId) as any;

    const resolvedCases = this.db
      .prepare(`SELECT COUNT(*) AS count FROM cases WHERE organization_id = ? AND status IN ('closed', 'resolved')`)
      .get(organizationId) as any;

    return {
      organization: org,
      entitlements: entitlements || null,
      members,
      activeInvitations,
      caseStats: {
        total: totalCases?.count || 0,
        open: openCases?.count || 0,
        resolved: resolvedCases?.count || 0
      }
    };
  }

  /**
   * Adjusts plan entitlements or custom feature limits for an organization
   */
  public adjustEntitlements(
    organizationId: string,
    input: UpdateEntitlementsInput,
    actor: ActorContext
  ) {
    const updated = this.entitlementService.updateEntitlements(organizationId, input, actor);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'admin.entitlements_adjusted',
      resource_type: 'organization',
      resource_id: organizationId,
      details: {
        updates: input,
        updated_entitlements: updated
      }
    });

    return updated;
  }

  /**
   * Suspend an organization
   */
  public suspendOrganization(organizationId: string, reason: string, actor: ActorContext) {
    const org = this.db.prepare('SELECT id, status FROM organizations WHERE id = ?').get(organizationId) as any;
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    this.db
      .prepare(`UPDATE organizations SET status = 'suspended', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?`)
      .run(organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'admin.organization_suspended',
      resource_type: 'organization',
      resource_id: organizationId,
      details: { reason, previous_status: org.status }
    });

    return { id: organizationId, status: 'suspended', reason };
  }

  /**
   * Reactivate an organization
   */
  public reactivateOrganization(organizationId: string, actor: ActorContext) {
    const org = this.db.prepare('SELECT id, status FROM organizations WHERE id = ?').get(organizationId) as any;
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    this.db
      .prepare(`UPDATE organizations SET status = 'active', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?`)
      .run(organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'admin.organization_reactivated',
      resource_type: 'organization',
      resource_id: organizationId,
      details: { previous_status: org.status }
    });

    return { id: organizationId, status: 'active' };
  }

  /**
   * Archival offboarding: soft deactivates organization preserving evidence, submissions, and audit logs
   */
  public offboardOrganization(organizationId: string, reason: string, actor: ActorContext) {
    const org = this.db.prepare('SELECT id, status FROM organizations WHERE id = ?').get(organizationId) as any;
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const now = new Date().toISOString();

    const stmt = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE organizations 
          SET status = 'deactivated',
              deactivated_at = ?,
              deactivation_reason = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .run(now, reason, now, organizationId);

      // Revoke any pending invitations
      this.db
        .prepare(`UPDATE organization_invitations SET status = 'revoked' WHERE organization_id = ? AND status = 'pending'`)
        .run(organizationId);

      // Record audit event
      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actor.user_id,
        actor_email: actor.email,
        action: 'organization.offboarded',
        resource_type: 'organization',
        resource_id: organizationId,
        details: {
          reason,
          offboarded_at: now,
          mode: 'archival_soft_deactivation',
          evidence_preserved: true
        }
      });
    });

    stmt();

    return {
      id: organizationId,
      status: 'deactivated',
      deactivated_at: now,
      deactivated_reason: reason,
      message: 'Organization archived. All evidence files and chain-of-custody audit records preserved.'
    };
  }

  /**
   * List failed or stuck outbox notifications for administrative review
   */
  public listFailedNotifications(limit: number = 50) {
    return this.db
      .prepare(`
        SELECT * FROM notification_outbox 
        WHERE status = 'failed' 
        ORDER BY created_at DESC 
        LIMIT ?
      `)
      .all(limit);
  }

  /**
   * Retry a failed notification outbox item
   */
  public retryFailedNotification(outboxId: string, actor: ActorContext) {
    const item = this.db.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(outboxId) as any;
    if (!item) {
      throw new Error(`Notification outbox item ${outboxId} not found`);
    }

    this.db
      .prepare(`
        UPDATE notification_outbox 
        SET status = 'pending',
            retry_count = 0,
            last_error = NULL,
            scheduled_for = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ?
      `)
      .run(outboxId);

    this.auditService.record({
      organization_id: item.organization_id,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'admin.notification_retried',
      resource_type: 'notification_outbox',
      resource_id: outboxId,
      details: { original_recipient: item.recipient_email || item.recipient_user_id }
    });

    return { id: outboxId, status: 'pending' };
  }

  /**
   * System worker health status summary
   */
  public getWorkerHeartbeats() {
    return this.db
      .prepare('SELECT * FROM worker_heartbeats ORDER BY last_heartbeat_at DESC')
      .all();
  }
}
