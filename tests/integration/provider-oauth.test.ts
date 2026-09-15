import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { OAuthService } from '../../src/services/integrations/oauth-service.js';
import { YouTubeReadOnlyAdapter } from '../../src/services/integrations/youtube-adapter.js';

describe('Integration: Provider OAuth 2.0 & Token Security', () => {
  let db: Database.Database;
  let oauthService: OAuthService;
  const adapter = new YouTubeReadOnlyAdapter({ isMockMode: true });

  const orgA = 'org_oauth_alpha_01';
  const orgB = 'org_oauth_beta_02';
  const userA = 'usr_oauth_alpha_01';
  const userB = 'usr_oauth_beta_02';
  const subjectA = 'sub_oauth_alpha_01';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);

    // Seed organizations and users
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Org Alpha', 'org-alpha', 'healthcare', 'IN-DL', 'alpha@example.in'),
             (?, 'Org Beta', 'org-beta', 'finance', 'IN-MH', 'beta@example.in')
    `).run(orgA, orgB);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'user.alpha@example.in', 'User Alpha', 'pw1'),
             (?, 'user.beta@example.in', 'User Beta', 'pw2')
    `).run(userA, userB);

    db.prepare(`
      INSERT INTO pilot_entitlements (id, organization_id, pilot_start_date, pilot_end_date, is_integration_canary_enabled, max_provider_connections)
      VALUES ('ent_alpha', ?, '2026-01-01', '2026-12-31', 1, 2),
             ('ent_beta', ?, '2026-01-01', '2026-12-31', 0, 1)
    `).run(orgA, orgB);

    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, created_by_user_id
      ) VALUES (
        ?, ?, 'doctor', 'Dr. Alpha Rao', 'representation_agreement', 'REF-ALPHA', ?
      )
    `).run(subjectA, orgA, userA);

    oauthService = new OAuthService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('generates a valid, cryptographically signed OAuth state nonce with 10-minute expiration', () => {
    const { stateToken, expiresAt } = oauthService.generateState(orgA, userA, 'youtube', subjectA);

    expect(stateToken).toBeDefined();
    expect(stateToken.split('.')).toHaveLength(2); // payload.signature
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);

    // Verify row in database
    const nonce = db.prepare('SELECT * FROM oauth_state_nonces WHERE state_token = ?').get(stateToken) as any;
    expect(nonce).toBeDefined();
    expect(nonce.organization_id).toBe(orgA);
    expect(nonce.user_id).toBe(userA);
    expect(nonce.consumed_at).toBeNull();
  });

  it('rejects tampered or forged state token signature', () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube');
    const [payload, signature] = stateToken.split('.');

    // Tamper signature
    const tamperedSig = signature.slice(0, -2) + (signature.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedToken = `${payload}.${tamperedSig}`;

    expect(() => oauthService.verifyAndConsumeState(tamperedToken, orgA)).toThrow(
      /State token cryptographic signature mismatch/
    );
  });

  it('rejects cross-tenant state token exchange (Tenant B cannot consume Tenant A state)', () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube');

    // Org B attempts to use Org A's state token
    expect(() => oauthService.verifyAndConsumeState(stateToken, orgB)).toThrow(
      /State token belongs to a different organization/
    );
  });

  it('blocks state token replay attacks once consumed', () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube');

    // First consumption succeeds
    const verified = oauthService.verifyAndConsumeState(stateToken, orgA);
    expect(verified.organizationId).toBe(orgA);

    // Second consumption must fail
    expect(() => oauthService.verifyAndConsumeState(stateToken, orgA)).toThrow(
      /State token has already been consumed/
    );
  });

  it('rejects expired state tokens', () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube');

    // Artificially expire the state token in database and payload
    db.prepare(`
      UPDATE oauth_state_nonces SET expires_at = '2026-01-01T00:00:00Z' WHERE state_token = ?
    `).run(stateToken);

    // Reconstruct expired signed token
    const [payload] = stateToken.split('.');
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    obj.expiresAt = '2026-01-01T00:00:00Z'; // expired date
    const b64Expired = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
    const hmac = crypto.createHmac('sha256', (oauthService as any).getStateSecret()).update(b64Expired).digest('hex');
    const expiredToken = `${b64Expired}.${hmac}`;

    expect(() => oauthService.verifyAndConsumeState(expiredToken, orgA)).toThrow(
      /State token has expired/
    );
  });

  it('completes OAuth flow, stores encrypted tokens at rest, and returns sanitized connection', async () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube', subjectA);

    const connection = await oauthService.completeOAuthFlow(
      orgA,
      {
        provider_type: 'youtube',
        state: stateToken,
        code: 'mock_valid_auth_code_123'
      },
      adapter,
      userA
    );

    expect(connection).toBeDefined();
    expect(connection.organization_id).toBe(orgA);
    expect(connection.status).toBe('connected');
    expect(connection.provider_type).toBe('youtube');
    expect(connection.account_id).toBe('UC_mock_channel_doctor_rao_01');
    expect(connection.account_name).toContain('Dr. Ananya Rao');
    expect(connection.is_canary).toBe(1);

    // Verify token fields are NOT present on public connection object
    expect((connection as any).encrypted_access_token).toBeUndefined();
    expect((connection as any).access_token).toBeUndefined();
    expect((connection as any).encrypted_refresh_token).toBeUndefined();

    // Verify tokens ARE encrypted in raw SQLite database
    const rawRow = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(connection.id) as any;
    expect(rawRow.encrypted_access_token).toBeDefined();
    expect(rawRow.encrypted_access_token.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(rawRow.encrypted_access_token).not.toContain('ya29.mock');

    // Verify internal credential retrieval can decrypt
    const internal = oauthService.getInternalConnectionWithCredentials(connection.id);
    expect(internal).toBeDefined();
    expect(internal!.decryptedAccessToken).toContain('ya29.mock');
    expect(internal!.decryptedRefreshToken).toContain('1//mock');

    // Verify linked subject exists
    const subjects = oauthService.getLinkedSubjects(connection.id);
    expect(subjects).toEqual([subjectA]);

    // Verify circuit state was initialized
    const cs = db.prepare('SELECT * FROM provider_circuit_states WHERE connection_id = ?').get(connection.id) as any;
    expect(cs.circuit_state).toBe('closed');

    // Verify audit record was written
    const audits = db.prepare(`
      SELECT * FROM audit_events WHERE resource_id = ? AND action = 'oauth_connection_established'
    `).all(connection.id);
    expect(audits).toHaveLength(1);
  });

  it('disconnects connection, wipes encrypted credentials, and deletes sync cursors', async () => {
    const { stateToken } = oauthService.generateState(orgA, userA, 'youtube', subjectA);
    const conn = await oauthService.completeOAuthFlow(
      orgA,
      { provider_type: 'youtube', state: stateToken, code: 'mock_code_456' },
      adapter,
      userA
    );

    // Add a cursor
    db.prepare(`
      INSERT INTO provider_sync_cursors (id, connection_id, feed_type)
      VALUES ('cur_test_01', ?, 'channel_uploads')
    `).run(conn.id);

    // Disconnect
    oauthService.disconnect(orgA, conn.id, userA);

    const updated = oauthService.getConnection(orgA, conn.id);
    expect(updated?.status).toBe('disconnected');
    expect(updated?.is_paused).toBe(1);

    // Ensure raw database credentials are nullified
    const raw = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(conn.id) as any;
    expect(raw.encrypted_access_token).toBeNull();
    expect(raw.encrypted_refresh_token).toBeNull();

    // Verify cursors are purged
    const cursors = db.prepare('SELECT * FROM provider_sync_cursors WHERE connection_id = ?').all(conn.id);
    expect(cursors).toHaveLength(0);

    // Verify audit event
    const audits = db.prepare(`
      SELECT * FROM audit_events WHERE resource_id = ? AND action = 'oauth_connection_disconnected'
    `).all(conn.id);
    expect(audits).toHaveLength(1);
  });
});
