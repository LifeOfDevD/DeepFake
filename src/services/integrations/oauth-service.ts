import crypto from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import { getConfig } from '../../config/env.js';
import {
  CompleteOAuthInput,
  CompleteOAuthSchema,
  ProviderConnection,
  ProviderType
} from '../../domain/types.js';
import { TokenEncryption } from './token-encryption.js';
import { ProviderAdapter } from './provider-adapter-interface.js';
import { AuditService } from '../audit-service.js';

export class OAuthService {
  private db: Database.Database;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.auditService = new AuditService(this.db);
  }

  /**
   * Derives state HMAC signature secret
   */
  private getStateSecret(): string {
    return getConfig().auth.sessionSecret;
  }

  /**
   * Generates a tamper-evident single-use state token bound to tenant and user (10-minute TTL)
   */
  public generateState(
    organizationId: string,
    userId: string,
    providerType: ProviderType,
    subjectId?: string
  ): { stateToken: string; expiresAt: string } {
    const nonce = uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Create JSON payload and HMAC signature
    const payloadObj = {
      orgId: organizationId,
      userId,
      providerType,
      subjectId: subjectId || null,
      expiresAt,
      nonce
    };
    const b64Payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    const hmac = crypto.createHmac('sha256', this.getStateSecret()).update(b64Payload).digest('hex');
    const stateToken = `${b64Payload}.${hmac}`;

    // Record in database for single-use enforcement
    const id = `ost_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    this.db.prepare(`
      INSERT INTO oauth_state_nonces (
        id, organization_id, user_id, provider_type, state_token, subject_id, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, organizationId, userId, providerType, stateToken, subjectId || null, expiresAt);

    return { stateToken, expiresAt };
  }

  /**
   * Verifies state authenticity, expiration, single-use, and tenant binding
   */
  public verifyAndConsumeState(
    stateToken: string,
    expectedOrgId: string
  ): { organizationId: string; userId: string; providerType: ProviderType; subjectId?: string } {
    if (!stateToken || !stateToken.includes('.')) {
      throw new Error('OAUTH_STATE_INVALID: Malformed state token format');
    }

    const [b64Payload, signature] = stateToken.split('.');

    // Verify HMAC signature first on b64Payload
    const expectedHmac = crypto.createHmac('sha256', this.getStateSecret()).update(b64Payload).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedHmac);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('OAUTH_STATE_INVALID: State token cryptographic signature mismatch');
    }

    let payloadObj: any;
    try {
      payloadObj = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    } catch {
      throw new Error('OAUTH_STATE_INVALID: Failed to decode state token payload');
    }

    const { orgId, userId, providerType, subjectId, expiresAt } = payloadObj;
    if (!orgId || !userId || !providerType || !expiresAt) {
      throw new Error('OAUTH_STATE_INVALID: Incomplete state token payload');
    }

    // Verify tenant match
    if (orgId !== expectedOrgId) {
      throw new Error('OAUTH_TENANT_MISMATCH: State token belongs to a different organization');
    }

    // Verify expiration
    if (new Date(expiresAt).getTime() < Date.now()) {
      throw new Error('OAUTH_STATE_EXPIRED: State token has expired (10-minute window exceeded)');
    }

    // Verify single-use nonce in database
    const nonceRecord = this.db.prepare(`
      SELECT * FROM oauth_state_nonces WHERE state_token = ?
    `).get(stateToken) as any;

    if (!nonceRecord) {
      throw new Error('OAUTH_STATE_INVALID: State token unrecognized or not found in registry');
    }

    if (nonceRecord.consumed_at) {
      throw new Error('OAUTH_STATE_REPLAY: State token has already been consumed (replay attack blocked)');
    }

    // Mark as consumed
    this.db.prepare(`
      UPDATE oauth_state_nonces SET consumed_at = ? WHERE id = ?
    `).run(new Date().toISOString(), nonceRecord.id);

    return {
      organizationId: orgId,
      userId,
      providerType: providerType as ProviderType,
      subjectId: subjectId || undefined
    };
  }

  /**
   * Completes the OAuth flow, exchanging code for tokens, storing encrypted credentials,
   * initializing circuit breaker, and linking authorized subjects.
   */
  public async completeOAuthFlow(
    expectedOrgId: string,
    input: CompleteOAuthInput,
    adapter: ProviderAdapter,
    actorUserId: string
  ): Promise<ProviderConnection> {
    const validated = CompleteOAuthSchema.parse(input);

    // 1. Verify and consume state token
    const stateContext = this.verifyAndConsumeState(validated.state, expectedOrgId);

    // 2. Organization entitlement / canary verification
    const ent = this.db.prepare(`
      SELECT is_integration_canary_enabled, max_provider_connections
      FROM pilot_entitlements WHERE organization_id = ?
    `).get(stateContext.organizationId) as { is_integration_canary_enabled?: number; max_provider_connections?: number } | undefined;

    // Check existing connections
    const currentConnCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM provider_connections
      WHERE organization_id = ? AND status != 'disconnected'
    `).get(stateContext.organizationId) as { count: number }).count;

    const maxConnections = ent?.max_provider_connections ?? 2;
    if (currentConnCount >= maxConnections) {
      throw new Error(`PROVIDER_QUOTA_EXCEEDED: Maximum of ${maxConnections} active provider connections allowed for this organization`);
    }

    // 3. Exchange code for tokens via provider adapter
    const redirectUri = validated.redirect_uri || `${getConfig().appUrl}/api/integrations/oauth/callback`;
    const tokens = await adapter.exchangeCode(validated.code, redirectUri);

    // 4. Retrieve authenticated profile
    const profile = await adapter.getAccountProfile(tokens.accessToken);

    // 5. Encrypt tokens at rest
    const encryptedAccess = TokenEncryption.encrypt(tokens.accessToken);
    const encryptedRefresh = tokens.refreshToken ? TokenEncryption.encrypt(tokens.refreshToken) : null;

    const expiresAt = tokens.expiresInSeconds
      ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
      : null;

    const now = new Date().toISOString();
    const connectionId = `conn_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const isCanary = ent?.is_integration_canary_enabled ? 1 : 0;

    // 6. Persist connection and related records in transaction
    const tx = this.db.transaction(() => {
      // Insert connection
      this.db.prepare(`
        INSERT INTO provider_connections (
          id, organization_id, provider_type, status, account_id, account_name,
          account_email, scopes, encrypted_access_token, encrypted_refresh_token,
          token_expires_at, last_token_refresh_at, is_canary, metadata,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        connectionId,
        stateContext.organizationId,
        adapter.providerType,
        profile.accountId,
        profile.accountName,
        profile.accountEmail || null,
        JSON.stringify(tokens.scopes),
        encryptedAccess,
        encryptedRefresh,
        expiresAt,
        now,
        isCanary,
        JSON.stringify(profile.rawDetails || {}),
        actorUserId,
        now,
        now
      );

      // Initialize circuit breaker state
      this.db.prepare(`
        INSERT INTO provider_circuit_states (
          connection_id, circuit_state, failure_count, consecutive_successes,
          total_requests, total_failures, total_retries, updated_at
        ) VALUES (?, 'closed', 0, 0, 0, 0, 0, ?)
      `).run(connectionId, now);

      // Link subject if provided
      if (stateContext.subjectId) {
        const linkId = `pcs_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
        this.db.prepare(`
          INSERT INTO provider_connection_subjects (id, connection_id, subject_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(linkId, connectionId, stateContext.subjectId, now);
      }

      // Record audit event
      this.auditService.record({
        organization_id: stateContext.organizationId,
        actor_user_id: actorUserId,
        actor_email: 'actor@desk.internal',
        action: 'oauth_connection_established',
        resource_type: 'provider_connection',
        resource_id: connectionId,
        details: {
          provider_type: adapter.providerType,
          account_id: profile.accountId,
          account_name: profile.accountName,
          scopes: tokens.scopes,
          is_canary: isCanary
        }
      });
    });

    tx();

    return this.getConnection(stateContext.organizationId, connectionId)!;
  }

  /**
   * Retrieves a sanitized connection by ID (tokens are never returned)
   */
  public getConnection(organizationId: string, connectionId: string): ProviderConnection | null {
    const row = this.db.prepare(`
      SELECT * FROM provider_connections WHERE id = ? AND organization_id = ?
    `).get(connectionId, organizationId) as any;

    if (!row) return null;
    return this.mapRowToConnection(row);
  }

  /**
   * Retrieves internal connection with encrypted credentials (service use only)
   */
  public getInternalConnectionWithCredentials(connectionId: string): {
    connection: ProviderConnection;
    decryptedAccessToken: string;
    decryptedRefreshToken?: string;
  } | null {
    const row = this.db.prepare(`
      SELECT * FROM provider_connections WHERE id = ?
    `).get(connectionId) as any;

    if (!row) return null;

    if (!row.encrypted_access_token) {
      throw new Error('PROVIDER_AUTH_ERROR: Connection has no access token stored');
    }

    const decryptedAccessToken = TokenEncryption.decrypt(row.encrypted_access_token);
    const decryptedRefreshToken = row.encrypted_refresh_token
      ? TokenEncryption.decrypt(row.encrypted_refresh_token)
      : undefined;

    return {
      connection: this.mapRowToConnection(row),
      decryptedAccessToken,
      decryptedRefreshToken
    };
  }

  /**
   * Lists all provider connections for an organization (sanitized)
   */
  public listConnections(organizationId: string): ProviderConnection[] {
    const rows = this.db.prepare(`
      SELECT * FROM provider_connections WHERE organization_id = ? ORDER BY created_at DESC
    `).all(organizationId) as any[];

    return rows.map((r) => this.mapRowToConnection(r));
  }

  /**
   * Disconnects a provider connection: wipes encrypted tokens, cancels subscriptions,
   * purges ephemeral cursors, and logs audit event.
   */
  public disconnect(organizationId: string, connectionId: string, actorUserId: string): void {
    const existing = this.getConnection(organizationId, connectionId);
    if (!existing) {
      throw new Error('CONNECTION_NOT_FOUND: Provider connection does not exist');
    }

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      // Wipe tokens and set status to disconnected
      this.db.prepare(`
        UPDATE provider_connections SET
          status = 'disconnected',
          encrypted_access_token = NULL,
          encrypted_refresh_token = NULL,
          is_paused = 1,
          updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).run(now, connectionId, organizationId);

      // Clean up sync cursors
      this.db.prepare('DELETE FROM provider_sync_cursors WHERE connection_id = ?').run(connectionId);

      // Deactivate webhook subscriptions
      this.db.prepare(`
        UPDATE provider_webhook_subscriptions SET status = 'expired', updated_at = ?
        WHERE connection_id = ?
      `).run(now, connectionId);

      // Audit disconnect
      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'actor@desk.internal',
        action: 'oauth_connection_disconnected',
        resource_type: 'provider_connection',
        resource_id: connectionId,
        details: {
          provider_type: existing.provider_type,
          account_id: existing.account_id
        }
      });
    });

    tx();
  }

  /**
   * Pauses an active provider connection
   */
  public pauseConnection(organizationId: string, connectionId: string, actorUserId: string): void {
    const existing = this.getConnection(organizationId, connectionId);
    if (!existing) {
      throw new Error('CONNECTION_NOT_FOUND: Provider connection does not exist');
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_connections SET
        is_paused = 1,
        updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(now, connectionId, organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'actor@desk.internal',
      action: 'oauth_connection_paused',
      resource_type: 'provider_connection',
      resource_id: connectionId,
      details: {
        provider_type: existing.provider_type,
        account_id: existing.account_id
      }
    });
  }

  /**
   * Resumes a paused provider connection
   */
  public resumeConnection(organizationId: string, connectionId: string, actorUserId: string): void {
    const existing = this.getConnection(organizationId, connectionId);
    if (!existing) {
      throw new Error('CONNECTION_NOT_FOUND: Provider connection does not exist');
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_connections SET
        is_paused = 0,
        updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(now, connectionId, organizationId);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'actor@desk.internal',
      action: 'oauth_connection_resumed',
      resource_type: 'provider_connection',
      resource_id: connectionId,
      details: {
        provider_type: existing.provider_type,
        account_id: existing.account_id
      }
    });
  }

  /**
   * Links or unlinks monitored subjects for a connection
   */
  public updateConnectionSubjects(
    organizationId: string,
    connectionId: string,
    subjectIds: string[]
  ): void {
    const conn = this.getConnection(organizationId, connectionId);
    if (!conn) {
      throw new Error('CONNECTION_NOT_FOUND: Provider connection does not exist');
    }

    // Verify all subjects belong to this organization
    for (const sid of subjectIds) {
      const subj = this.db.prepare('SELECT id FROM monitored_subjects WHERE id = ? AND organization_id = ?').get(sid, organizationId);
      if (!subj) {
        throw new Error(`SUBJECT_NOT_FOUND: Monitored subject ${sid} does not belong to organization`);
      }
    }

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM provider_connection_subjects WHERE connection_id = ?').run(connectionId);
      for (const sid of subjectIds) {
        const linkId = `pcs_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
        this.db.prepare(`
          INSERT INTO provider_connection_subjects (id, connection_id, subject_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(linkId, connectionId, sid, now);
      }
    });

    tx();
  }

  /**
   * Retrieves subject IDs linked to a connection
   */
  public getLinkedSubjects(connectionId: string): string[] {
    const rows = this.db.prepare(`
      SELECT subject_id FROM provider_connection_subjects WHERE connection_id = ?
    `).all(connectionId) as { subject_id: string }[];

    return rows.map((r) => r.subject_id);
  }

  /**
   * Refreshes the connection's access token using the encrypted refresh token
   */
  public async refreshConnectionToken(connectionId: string, adapter: ProviderAdapter): Promise<void> {
    const creds = this.getInternalConnectionWithCredentials(connectionId);
    if (!creds || !creds.decryptedRefreshToken) {
      this.markConnectionError(connectionId, 'NO_REFRESH_TOKEN: Cannot refresh without valid refresh token');
      throw new Error('Cannot refresh token: refresh token not present');
    }

    try {
      const refreshed = await adapter.refreshToken(creds.decryptedRefreshToken);
      const newEncryptedAccess = TokenEncryption.encrypt(refreshed.accessToken);
      const newEncryptedRefresh = refreshed.refreshToken
        ? TokenEncryption.encrypt(refreshed.refreshToken)
        : TokenEncryption.encrypt(creds.decryptedRefreshToken);

      const now = new Date().toISOString();
      const expiresAt = refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString()
        : null;

      this.db.prepare(`
        UPDATE provider_connections SET
          encrypted_access_token = ?,
          encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
          token_expires_at = ?,
          last_token_refresh_at = ?,
          status = 'connected',
          last_error = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(newEncryptedAccess, newEncryptedRefresh, expiresAt, now, now, connectionId);
    } catch (err: any) {
      this.markConnectionError(connectionId, `REFRESH_FAILED: ${err.message}`);
      throw err;
    }
  }

  /**
   * Marks connection status to error or degraded
   */
  public markConnectionError(connectionId: string, errorReason: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_connections SET
        status = 'error',
        last_error = ?,
        error_count = error_count + 1,
        updated_at = ?
      WHERE id = ?
    `).run(errorReason, now, connectionId);
  }

  private mapRowToConnection(row: any): ProviderConnection {
    return {
      id: row.id,
      organization_id: row.organization_id,
      provider_type: row.provider_type,
      status: row.status,
      account_id: row.account_id,
      account_name: row.account_name,
      account_email: row.account_email,
      scopes: JSON.parse(row.scopes || '[]'),
      token_expires_at: row.token_expires_at,
      last_token_refresh_at: row.last_token_refresh_at,
      last_successful_sync_at: row.last_successful_sync_at,
      last_error: row.last_error,
      error_count: row.error_count || 0,
      is_canary: row.is_canary || 0,
      is_paused: row.is_paused || 0,
      metadata: JSON.parse(row.metadata || '{}'),
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
