import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  CreateOrganizationInput,
  InviteUserInput,
  Membership,
  Organization,
  Role,
  User
} from '../domain/types.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';

export class TenantService {
  private auditService: AuditService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
  }

  /**
   * Creates a new organization workspace
   */
  public createOrganization(input: CreateOrganizationInput, creatorActor?: ActorContext): Organization {
    const id = `org_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO organizations (
        id, name, slug, industry, jurisdiction, timezone, primary_contact_email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.name,
      input.slug,
      input.industry,
      input.jurisdiction || 'IN-DL',
      input.timezone || 'Asia/Kolkata',
      input.primary_contact_email,
      now,
      now
    );

    if (creatorActor) {
      // Auto-assign creator as org_owner
      this.addMembership(creatorActor.user_id, id, 'org_owner');

      this.auditService.record({
        organization_id: id,
        actor_user_id: creatorActor.user_id,
        actor_email: creatorActor.email,
        action: 'org.created',
        resource_type: 'organization',
        resource_id: id,
        details: { name: input.name, slug: input.slug },
        ip_address: creatorActor.ip_address
      });
    }

    return this.getOrganizationById(id)!;
  }

  public getOrganizationById(id: string): Organization | null {
    const stmt = this.db.prepare('SELECT * FROM organizations WHERE id = ?');
    const row = stmt.get(id) as Organization | undefined;
    return row || null;
  }

  public listOrganizations(): Organization[] {
    return this.db.prepare('SELECT * FROM organizations ORDER BY name ASC').all() as Organization[];
  }

  public getUserById(userId: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(userId) as User | undefined;
    return row || null;
  }

  public getUserByEmail(email: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email) as User | undefined;
    return row || null;
  }

  public getMembership(userId: string, organizationId: string): Membership | null {
    const stmt = this.db.prepare(`
      SELECT * FROM memberships
      WHERE user_id = ? AND organization_id = ?
    `);
    const row = stmt.get(userId, organizationId) as Membership | undefined;
    return row || null;
  }

  public getUserMemberships(userId: string): (Membership & { organization_name: string; organization_slug: string })[] {
    const stmt = this.db.prepare(`
      SELECT m.*, o.name as organization_name, o.slug as organization_slug
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ?
    `);
    return stmt.all(userId) as (Membership & { organization_name: string; organization_slug: string })[];
  }

  public addMembership(userId: string, organizationId: string, role: Role): Membership {
    const id = `mem_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO memberships (id, user_id, organization_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, userId, organizationId, role, now);

    return {
      id,
      user_id: userId,
      organization_id: organizationId,
      role,
      created_at: now
    };
  }

  /**
   * Invites a new user into an organization
   */
  public inviteUser(organizationId: string, input: InviteUserInput, actor: ActorContext): { user: User; membership: Membership } {
    const org = this.getOrganizationById(organizationId);
    if (!org) {
      throw new Error(`Organization '${organizationId}' not found.`);
    }

    if (actor.role !== 'org_owner' && actor.role !== 'org_admin' && actor.role !== 'system_admin') {
      throw new Error('Only Organization Owners or Admins can invite team members.');
    }

    let user = this.getUserByEmail(input.email);
    const now = new Date().toISOString();

    if (!user) {
      const userId = `usr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      this.db
        .prepare(`
          INSERT INTO users (id, email, full_name, password_hash, system_role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'user', 1, ?, ?)
        `)
        .run(userId, input.email, input.full_name, 'mock_pw_hash', now, now);

      user = this.getUserById(userId)!;
    }

    const existingMembership = this.getMembership(user.id, organizationId);
    if (existingMembership) {
      throw new Error(`User '${input.email}' is already a member of this organization.`);
    }

    const membership = this.addMembership(user.id, organizationId, input.role);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'user.invited',
      resource_type: 'membership',
      resource_id: membership.id,
      details: {
        invited_user_id: user.id,
        invited_email: input.email,
        role: input.role
      },
      ip_address: actor.ip_address
    });

    return { user, membership };
  }

  /**
   * Deletes a user account while safely preserving historical audit logs
   */
  public deleteUserSafely(userId: string): void {
    // 1. Remove memberships
    this.db.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
    // 2. Unassign assigned cases
    this.db.prepare('UPDATE cases SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ?').run(userId);
    // 3. Delete user row
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    // Notice: audit_events does NOT have a foreign key CASCADE to users(id), so all historical audit records remain intact!
  }
}
