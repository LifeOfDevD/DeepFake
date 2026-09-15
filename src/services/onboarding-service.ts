import Database from 'better-sqlite3';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  AcceptInvitationInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  OnboardingChecklist,
  Organization,
  OrganizationInvitationRecord,
  PlanTier,
  Role,
  User
} from '../domain/types.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';
import { NotificationService } from './notification-service.js';
import { EntitlementService } from './entitlement-service.js';

export class OnboardingService {
  private auditService: AuditService;
  private notificationService: NotificationService;
  private entitlementService: EntitlementService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
    this.notificationService = new NotificationService(this.db);
    this.entitlementService = new EntitlementService(this.db);
  }

  /**
   * Initializes a new organization in 'onboarding' status
   */
  public createOrganization(input: CreateOrganizationInput, creatorActor?: ActorContext): Organization {
    const orgId = `org_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const initialChecklist: OnboardingChecklist = {
      profile_complete: true,
      owner_assigned: Boolean(creatorActor),
      legal_reviewer_assigned: false,
      retention_configured: true,
      playbook_acknowledged: false,
      terms_accepted: false,
      test_case_completed: false
    };

    const stmt = this.db.prepare(`
      INSERT INTO organizations (
        id, name, slug, industry, jurisdiction, timezone, primary_contact_email,
        status, onboarding_checklist, pilot_settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      orgId,
      input.name,
      input.slug,
      input.industry,
      input.jurisdiction || 'IN-DL',
      input.timezone || 'Asia/Kolkata',
      input.primary_contact_email,
      'onboarding',
      JSON.stringify(initialChecklist),
      JSON.stringify({ terms_accepted: false, playbook_acknowledged: false }),
      now,
      now
    );

    // Initialize default pilot entitlements
    this.entitlementService.initializeDefaultEntitlements(orgId);

    if (creatorActor) {
      // Assign creator as org_owner
      const memId = `mem_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      this.db
        .prepare(`
          INSERT INTO memberships (id, user_id, organization_id, role, created_at)
          VALUES (?, ?, ?, 'org_owner', ?)
        `)
        .run(memId, creatorActor.user_id, orgId, now);

      this.auditService.record({
        organization_id: orgId,
        actor_user_id: creatorActor.user_id,
        actor_email: creatorActor.email,
        action: 'org.onboarding_initiated',
        resource_type: 'organization',
        resource_id: orgId,
        details: { name: input.name, slug: input.slug, timezone: input.timezone || 'Asia/Kolkata' },
        ip_address: creatorActor.ip_address
      });
    }

    return this.getOrganizationById(orgId)!;
  }

  public createOrganizationWithPlan(
    input: CreateOrganizationInput,
    planTier: PlanTier = 'pilot',
    creatorUserId?: string,
    creatorActor?: ActorContext
  ): Organization {
    const org = this.createOrganization(input, creatorActor);
    if (planTier !== 'pilot') {
      this.entitlementService.updateEntitlements(
        org.id,
        { plan_tier: planTier },
        creatorActor || {
          user_id: creatorUserId || 'system',
          email: 'admin@system.local',
          role: 'system_admin'
        }
      );
    }
    return this.getOrganizationById(org.id)!;
  }

  public getOrganizationById(id: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Organization | undefined;
    return row || null;
  }

  public createInvitation(
    organizationId: string,
    input: CreateInvitationInput,
    actor: ActorContext
  ): { invitation: OrganizationInvitationRecord; rawToken: string } {
    return this.inviteUser(organizationId, input, actor);
  }

  public getOnboardingChecklist(organizationId: string) {
    return this.getOnboardingStatus(organizationId);
  }

  /**
   * Generates a single-use secure invitation token with expiration
   */
  public inviteUser(
    organizationId: string,
    input: CreateInvitationInput,
    actor: ActorContext
  ): { invitation: OrganizationInvitationRecord; rawToken: string } {
    const org = this.getOrganizationById(organizationId);
    if (!org) {
      throw new Error(`Organization '${organizationId}' not found.`);
    }

    if (org.status === 'deactivated' || org.status === 'suspended') {
      throw new Error(`Cannot invite members to a ${org.status} organization.`);
    }

    if (actor.role !== 'org_owner' && actor.role !== 'org_admin' && actor.role !== 'system_admin') {
      throw new Error('Only Organization Owners or Admins are authorized to invite team members.');
    }

    // Role hierarchy check: Admins cannot invite Owners
    if (actor.role === 'org_admin' && input.role === 'org_owner') {
      throw new Error('Admins cannot invite Organization Owners.');
    }

    // Check user limit from entitlements
    this.entitlementService.assertCanInviteUser(organizationId);

    // Check if user is already a member
    const existingUser = this.db.prepare('SELECT id FROM users WHERE email = ?').get(input.email) as { id: string } | undefined;
    if (existingUser) {
      const membership = this.db.prepare('SELECT id FROM memberships WHERE user_id = ? AND organization_id = ?').get(
        existingUser.id,
        organizationId
      );
      if (membership) {
        throw new Error(`User '${input.email}' is already an active member of this organization.`);
      }
    }

    // Generate secure random token
    const rawToken = `inv_tok_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invitationId = `inv_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7-day expiry

    const stmt = this.db.prepare(`
      INSERT INTO organization_invitations (
        id, organization_id, email, role, token_hash, invited_by_user_id,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    stmt.run(
      invitationId,
      organizationId,
      input.email.toLowerCase().trim(),
      input.role,
      tokenHash,
      actor.user_id,
      expiresAt,
      now.toISOString(),
      now.toISOString()
    );

    // Queue invitation notification into outbox
    this.notificationService.queueNotification({
      organization_id: organizationId,
      recipient_email: input.email.toLowerCase().trim(),
      notification_type: 'invitation',
      title: `Invitation to join ${org.name}`,
      body: `You have been invited to join ${org.name} on the Digital Impersonation Response Desk as ${input.role}.`,
      payload: {
        organization_id: organizationId,
        invitation_id: invitationId,
        role: input.role,
        expires_at: expiresAt
      },
      idempotency_key: `inv_notify_${invitationId}`
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'user.invitation_issued',
      resource_type: 'invitation',
      resource_id: invitationId,
      details: { invited_email: input.email, role: input.role, expires_at: expiresAt },
      ip_address: actor.ip_address
    });

    const invitation = this.getInvitationById(invitationId)!;
    return { invitation, rawToken };
  }

  public getInvitationById(id: string): OrganizationInvitationRecord | null {
    const row = this.db.prepare('SELECT * FROM organization_invitations WHERE id = ?').get(id) as
      | OrganizationInvitationRecord
      | undefined;
    return row || null;
  }

  public listInvitations(organizationId: string): OrganizationInvitationRecord[] {
    return this.db
      .prepare('SELECT * FROM organization_invitations WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as OrganizationInvitationRecord[];
  }

  /**
   * Accepts an invitation using a single-use token
   */
  public acceptInvitation(input: AcceptInvitationInput): { user: User; organization: Organization; role: Role } {
    const tokenHash = crypto.createHash('sha256').update(input.token.trim()).digest('hex');

    const invitation = this.db
      .prepare('SELECT * FROM organization_invitations WHERE token_hash = ?')
      .get(tokenHash) as OrganizationInvitationRecord | undefined;

    if (!invitation) {
      throw new Error('Invalid or unrecognized invitation token.');
    }

    if (invitation.status === 'accepted') {
      throw new Error('This invitation has already been accepted (single-use token).');
    }

    if (invitation.status === 'revoked') {
      throw new Error('This invitation has been revoked by the organization administrator.');
    }

    const now = new Date().toISOString();
    if (invitation.expires_at < now) {
      this.db
        .prepare("UPDATE organization_invitations SET status = 'expired', updated_at = ? WHERE id = ?")
        .run(now, invitation.id);
      throw new Error('This invitation token has expired.');
    }

    const org = this.getOrganizationById(invitation.organization_id);
    if (!org || org.status === 'deactivated') {
      throw new Error('The target organization is no longer active.');
    }

    // Check or create user
    let user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(invitation.email) as User | undefined;
    if (!user) {
      const userId = `usr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      const passwordHash = crypto.createHash('sha256').update(input.password).digest('hex');

      this.db
        .prepare(`
          INSERT INTO users (id, email, full_name, password_hash, system_role, is_active, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'user', 1, 'active', ?, ?)
        `)
        .run(userId, invitation.email, input.full_name, passwordHash, now, now);

      user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
    }

    // Add membership
    const membershipId = `mem_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    this.db
      .prepare(`
        INSERT INTO memberships (id, user_id, organization_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(membershipId, user.id, invitation.organization_id, invitation.role, now);

    // Mark invitation accepted
    this.db
      .prepare(`
        UPDATE organization_invitations
        SET status = 'accepted', accepted_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, invitation.id);

    // Record audit event
    this.auditService.record({
      organization_id: invitation.organization_id,
      actor_user_id: user.id,
      actor_email: user.email,
      action: 'invitation.accepted',
      resource_type: 'membership',
      resource_id: membershipId,
      details: { role: invitation.role, invitation_id: invitation.id }
    });

    // Refresh onboarding checklist
    this.refreshOnboardingStatus(invitation.organization_id);

    return { user, organization: org, role: invitation.role };
  }

  /**
   * Revokes an active invitation
   */
  public revokeInvitation(organizationId: string, invitationId: string, actor: ActorContext): void {
    const inv = this.getInvitationById(invitationId);
    if (!inv || inv.organization_id !== organizationId) {
      throw new Error(`Invitation '${invitationId}' not found in this organization.`);
    }

    if (inv.status !== 'pending') {
      throw new Error(`Cannot revoke invitation in '${inv.status}' state.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE organization_invitations SET status = 'revoked', updated_at = ? WHERE id = ?")
      .run(now, invitationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'invitation.revoked',
      resource_type: 'invitation',
      resource_id: invitationId,
      details: { email: inv.email, role: inv.role },
      ip_address: actor.ip_address
    });
  }

  /**
   * Suspends a user in an organization
   */
  public suspendUser(
    organizationId: string,
    targetUserId: string,
    reason: string,
    actor: ActorContext
  ): void {
    if (actor.role !== 'org_owner' && actor.role !== 'system_admin') {
      throw new Error('Only Organization Owners or System Admins can suspend users.');
    }

    if (actor.user_id === targetUserId) {
      throw new Error('You cannot suspend your own account.');
    }

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as User | undefined;
    if (!user) {
      throw new Error(`User '${targetUserId}' not found.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE users
        SET status = 'suspended', suspended_at = ?, suspended_by = ?, suspension_reason = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, actor.user_id, reason.trim(), now, targetUserId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'user.suspended',
      resource_type: 'user',
      resource_id: targetUserId,
      details: { target_email: user.email, reason: reason.trim() },
      ip_address: actor.ip_address
    });
  }

  /**
   * Reactivates a suspended user
   */
  public reactivateUser(organizationId: string, targetUserId: string, actor: ActorContext): void {
    if (actor.role !== 'org_owner' && actor.role !== 'system_admin') {
      throw new Error('Only Organization Owners or System Admins can reactivate users.');
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE users
        SET status = 'active', suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(now, targetUserId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'user.reactivated',
      resource_type: 'user',
      resource_id: targetUserId,
      details: {},
      ip_address: actor.ip_address
    });
  }

  /**
   * Soft-deactivates an organization (preserves all audit logs & evidence for chain-of-custody)
   */
  public deactivateOrganization(organizationId: string, reason: string, actor: ActorContext): void {
    if (actor.role !== 'org_owner' && actor.role !== 'system_admin') {
      throw new Error('Only Organization Owners or System Admins can deactivate an organization.');
    }

    const org = this.getOrganizationById(organizationId);
    if (!org) {
      throw new Error(`Organization '${organizationId}' not found.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE organizations
        SET status = 'deactivated', deactivated_at = ?, deactivated_by = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, actor.user_id, now, organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'org.deactivated',
      resource_type: 'organization',
      resource_id: organizationId,
      details: { reason: reason.trim() },
      ip_address: actor.ip_address
    });
  }

  /**
   * Computes and returns the 7-step onboarding status checklist
   */
  public getOnboardingStatus(organizationId: string): {
    organization: Organization;
    checklist: OnboardingChecklist;
    isComplete: boolean;
  } {
    const org = this.getOrganizationById(organizationId);
    if (!org) {
      throw new Error(`Organization '${organizationId}' not found.`);
    }

    const members = this.db
      .prepare('SELECT role FROM memberships WHERE organization_id = ?')
      .all(organizationId) as { role: Role }[];

    const hasOwner = members.some((m) => m.role === 'org_owner');
    const hasLegal = members.some((m) => m.role === 'legal_reviewer');

    const caseCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM cases WHERE organization_id = ?').get(organizationId) as {
        cnt: number;
      }
    ).cnt;

    const settings = JSON.parse((org as any).pilot_settings || '{}');

    const checklist: OnboardingChecklist = {
      profile_complete: Boolean(org.name && org.slug && org.jurisdiction && org.primary_contact_email),
      owner_assigned: hasOwner,
      legal_reviewer_assigned: hasLegal,
      retention_configured: true,
      playbook_acknowledged: Boolean(settings.playbook_acknowledged),
      terms_accepted: Boolean(settings.terms_accepted),
      test_case_completed: caseCount > 0
    };

    const isComplete = Object.values(checklist).every(Boolean);

    // If all pass and org is still in 'onboarding', auto-activate
    if (isComplete && org.status === 'onboarding') {
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE organizations SET status = 'active', updated_at = ? WHERE id = ?")
        .run(now, organizationId);
      org.status = 'active';
    }

    return { organization: org, checklist, isComplete };
  }

  /**
   * Updates pilot settings (e.g. acknowledge terms or playbooks)
   */
  public updatePilotSettings(
    organizationId: string,
    updates: { terms_accepted?: boolean; playbook_acknowledged?: boolean },
    actor: ActorContext
  ): void {
    const org = this.getOrganizationById(organizationId);
    if (!org) throw new Error(`Organization '${organizationId}' not found.`);

    const current = JSON.parse((org as any).pilot_settings || '{}');
    const updated = { ...current, ...updates };

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE organizations SET pilot_settings = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(updated), now, organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'org.pilot_settings_updated',
      resource_type: 'organization',
      resource_id: organizationId,
      details: updates,
      ip_address: actor.ip_address
    });

    this.refreshOnboardingStatus(organizationId);
  }

  private refreshOnboardingStatus(organizationId: string): void {
    const status = this.getOnboardingStatus(organizationId);
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE organizations SET onboarding_checklist = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(status.checklist), now, organizationId);
  }
}
