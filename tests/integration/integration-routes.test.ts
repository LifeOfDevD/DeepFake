import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { ProviderSyncService } from '../../src/services/integrations/provider-sync-service.js';
import { TokenEncryption } from '../../src/services/integrations/token-encryption.js';
import { WebhookService } from '../../src/services/integrations/webhook-service.js';

describe('Integration: Phase 8 Controlled Read-Only Integrations REST API', () => {
  let app: any;
  let db: Database.Database;

  const orgCanary = 'org_canary_01';
  const orgNonCanary = 'org_standard_02';
  const orgOtherCanary = 'org_other_canary_03';

  const userCanaryAdmin = 'usr_canary_admin';
  const userCanaryAnalyst = 'usr_canary_analyst';
  const userStandardAdmin = 'usr_standard_admin';

  const subjectCanaryId = 'subj_canary_01';
  const connectionCanaryId = 'conn_canary_yt_01';

  beforeEach(() => {
    // Reset kill switch
    ProviderSyncService.setGlobalKillSwitch(false);

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);
    setDatabaseInstance(db);

    // Seed Organizations
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Canary Hospital', 'canary-hospital', 'healthcare', 'IN-DL', 'admin@canary.in'),
             (?, 'Standard Retail', 'standard-retail', 'commerce', 'IN-KA', 'admin@standard.in'),
             (?, 'Other Canary', 'other-canary', 'media', 'IN-MH', 'admin@other.in')
    `).run(orgCanary, orgNonCanary, orgOtherCanary);

    // Seed Users
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'canary.admin@hospital.in', 'Canary Admin', 'pw'),
             (?, 'canary.analyst@hospital.in', 'Canary Analyst', 'pw'),
             (?, 'standard.admin@retail.in', 'Standard Admin', 'pw'),
             ('usr_other_b', 'b@other.in', 'Other Admin', 'pw')
    `).run(userCanaryAdmin, userCanaryAnalyst, userStandardAdmin);

    // Seed User-Tenant Roles
    db.prepare(`
      INSERT INTO memberships (id, user_id, organization_id, role)
      VALUES ('mem_1', ?, ?, 'org_admin'),
             ('mem_2', ?, ?, 'analyst'),
             ('mem_3', ?, ?, 'org_admin'),
             ('mem_other_b', 'usr_other_b', ?, 'org_admin')
    `).run(userCanaryAdmin, orgCanary, userCanaryAnalyst, orgCanary, userStandardAdmin, orgNonCanary, orgOtherCanary);

    // Seed Pilot Entitlements (Canary vs Non-Canary)
    db.prepare(`
      INSERT INTO pilot_entitlements (
        id, organization_id, pilot_start_date, pilot_end_date,
        is_integration_canary_enabled, max_provider_connections
      ) VALUES
        ('ent_canary', ?, '2026-01-01', '2026-12-31', 1, 2),
        ('ent_standard', ?, '2026-01-01', '2026-12-31', 0, 1),
        ('ent_other', ?, '2026-01-01', '2026-12-31', 1, 2)
    `).run(orgCanary, orgNonCanary, orgOtherCanary);

    // Seed Monitored Subject for Canary Org
    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, monitoring_status, created_by_user_id
      ) VALUES (?, ?, 'doctor', 'Dr. Alok Verma', 'representation_agreement', 'AGR-2026-001', 'active', ?)
    `).run(subjectCanaryId, orgCanary, userCanaryAdmin);

    // Seed an Active Provider Connection for Canary Org
    const encAccessToken = TokenEncryption.encrypt('test_access_token_mock_123');
    const encRefreshToken = TokenEncryption.encrypt('test_refresh_token_mock_456');

    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        account_email, scopes, encrypted_access_token, encrypted_refresh_token,
        token_expires_at, is_canary, is_paused, metadata, created_by_user_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, 'youtube', 'connected', 'UC1234567890abcdef', 'Dr. Alok Verma Official Channel',
        'doctor.verma@gmail.com', '["https://www.googleapis.com/auth/youtube.readonly"]',
        ?, ?, '2027-01-01T00:00:00.000Z', 1, 0, '{}', ?, '2026-09-13T10:00:00.000Z', '2026-09-13T10:00:00.000Z'
      )
    `).run(connectionCanaryId, orgCanary, encAccessToken, encRefreshToken, userCanaryAdmin);

    // Link connection to subject
    db.prepare(`
      INSERT INTO provider_connection_subjects (id, connection_id, subject_id, created_at)
      VALUES ('pcs_test_1', ?, ?, '2026-09-13T10:00:00.000Z')
    `).run(connectionCanaryId, subjectCanaryId);

    // Initialize circuit breaker state
    db.prepare(`
      INSERT INTO provider_circuit_states (
        connection_id, circuit_state, failure_count, updated_at
      ) VALUES (?, 'closed', 0, '2026-09-13T10:00:00.000Z')
    `).run(connectionCanaryId);

    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  // ==========================================================================
  // 1. PUBLIC WEBSUB WEBHOOKS
  // ==========================================================================
  describe('Public WebSub Webhooks', () => {
    it('verifies WebSub hub challenge handshake on GET request', async () => {
      // Seed a subscription record
      db.prepare(`
        INSERT INTO provider_webhook_subscriptions (
          id, connection_id, topic_url, hub_url, secret_hash, lease_seconds, status, created_at, updated_at
        ) VALUES ('sub_1', ?, 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC1234567890abcdef',
          'https://pubsubhubbub.appspot.com', 'mock_hash', 86400, 'pending', '2026-09-13T10:00:00.000Z', '2026-09-13T10:00:00.000Z')
      `).run(connectionCanaryId);

      const res = await request(app)
        .get(`/api/integrations/youtube/webhook/${connectionCanaryId}`)
        .query({
          'hub.mode': 'subscribe',
          'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC1234567890abcdef',
          'hub.challenge': 'challenge_token_xyz_789',
          'hub.lease_seconds': '86400'
        });

      expect(res.status).toBe(200);
      expect(res.text).toBe('challenge_token_xyz_789');

      // Verify subscription status updated to active
      const sub = db.prepare('SELECT status FROM provider_webhook_subscriptions WHERE id = ?').get('sub_1') as any;
      expect(sub.status).toBe('active');
    });

    it('rejects WebSub POST notification with missing or invalid HMAC signature', async () => {
      const xmlPayload = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Mock Notification</title></feed>`;

      const res = await request(app)
        .post(`/api/integrations/youtube/webhook/${connectionCanaryId}`)
        .set('Content-Type', 'application/atom+xml')
        .set('X-Hub-Signature', 'sha1=invalid_hmac_hex')
        .send(xmlPayload);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/WEBSUB_SIGNATURE_MISMATCH|INVALID_SIGNATURE/);
    });

    it('accepts and ingests valid HMAC-signed WebSub video notification', async () => {
      const webhookService = new WebhookService(db);
      const secret = webhookService.getWebhookSecret(connectionCanaryId);

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <id>yt:video:vid_new_upload_001</id>
    <yt:videoId>vid_new_upload_001</yt:videoId>
    <yt:channelId>UC1234567890abcdef</yt:channelId>
    <title>Urgent Medical Advice from Dr. Alok</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vid_new_upload_001"/>
    <author><name>Dr. Alok Verma</name></author>
    <published>2026-09-13T12:00:00+00:00</published>
  </entry>
</feed>`;

      const hmacSha1 = crypto.createHmac('sha1', secret).update(xmlPayload).digest('hex');

      const res = await request(app)
        .post(`/api/integrations/youtube/webhook/${connectionCanaryId}`)
        .set('Content-Type', 'application/atom+xml')
        .set('X-Hub-Signature', `sha1=${hmacSha1}`)
        .send(xmlPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.received_signals).toBe(1);

      // Verify monitoring signal was ingested
      const signal = db.prepare(`
        SELECT * FROM monitoring_signals
        WHERE observed_url = ?
      `).get('https://www.youtube.com/watch?v=vid_new_upload_001') as any;

      expect(signal).toBeDefined();
      expect(signal.observed_url).toBe('https://www.youtube.com/watch?v=vid_new_upload_001');

      // Verify candidate review queue entry exists and is pending human review
      const review = db.prepare(`
        SELECT * FROM candidate_reviews WHERE signal_id = ?
      `).get(signal.id) as any;
      expect(review).toBeDefined();
      expect(review.status).toBe('pending');
    });

    it('rejects webhooks with 503 when global emergency kill-switch is active', async () => {
      ProviderSyncService.setGlobalKillSwitch(true);

      const res = await request(app)
        .post(`/api/integrations/youtube/webhook/${connectionCanaryId}`)
        .set('Content-Type', 'application/atom+xml')
        .send('<xml/>');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/KILL_SWITCH_ACTIVE/);
    });
  });

  // ==========================================================================
  // 2. CANARY ORGANIZATION GATING & ENROLLMENT ENFORCEMENT
  // ==========================================================================
  describe('Canary Organization Gating', () => {
    it('rejects non-canary organization access with 403 INTEGRATION_CANARY_DISABLED', async () => {
      const res = await request(app)
        .get('/api/integrations/connections')
        .set('x-organization-id', orgNonCanary)
        .set('x-user-id', userStandardAdmin);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/INTEGRATION_CANARY_DISABLED/);
    });

    it('rejects non-canary organization from initiating OAuth', async () => {
      const res = await request(app)
        .post('/api/integrations/oauth/initiate')
        .set('x-organization-id', orgNonCanary)
        .set('x-user-id', userStandardAdmin)
        .send({
          provider_type: 'youtube'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/INTEGRATION_CANARY_DISABLED/);
    });

    it('permits status check for non-canary org, returning canary_enabled: false', async () => {
      const res = await request(app)
        .get('/api/integrations/status')
        .set('x-organization-id', orgNonCanary)
        .set('x-user-id', userStandardAdmin);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.canary_enabled).toBe(false);
    });
  });

  // ==========================================================================
  // 3. SECRECY & CREDENTIAL SANITIZATION
  // ==========================================================================
  describe('Token Secrecy & Sanitization', () => {
    it('never leaks encrypted or decrypted access tokens in GET /api/integrations/connections', async () => {
      const res = await request(app)
        .get('/api/integrations/connections')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const conn = res.body.data[0];
      expect(conn.id).toBe(connectionCanaryId);
      expect(conn.encrypted_access_token).toBeUndefined();
      expect(conn.encrypted_refresh_token).toBeUndefined();
      expect(conn.access_token).toBeUndefined();
      expect(conn.refresh_token).toBeUndefined();

      // Ensure circuit health and linked subject count are provided
      expect(conn.circuit_state).toBe('closed');
      expect(conn.linked_subjects_count).toBe(1);
    });

    it('never leaks encrypted or decrypted tokens in GET /api/integrations/connections/:id', async () => {
      const res = await request(app)
        .get(`/api/integrations/connections/${connectionCanaryId}`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const conn = res.body.data.connection;
      expect(conn.encrypted_access_token).toBeUndefined();
      expect(conn.encrypted_refresh_token).toBeUndefined();
      expect(conn.access_token).toBeUndefined();
      expect(conn.refresh_token).toBeUndefined();

      expect(res.body.data.circuit).toBeDefined();
      expect(res.body.data.linked_subjects).toHaveLength(1);
      expect(res.body.data.linked_subjects[0].canonical_name).toBe('Dr. Alok Verma');
    });
  });

  // ==========================================================================
  // 4. CROSS-TENANT ISOLATION
  // ==========================================================================
  describe('Cross-Tenant Isolation', () => {
    it('prevents Canary Org B from accessing Canary Org A connection', async () => {
      const res = await request(app)
        .get(`/api/integrations/connections/${connectionCanaryId}`)
        .set('x-organization-id', orgOtherCanary)
        .set('x-user-id', 'usr_other_b');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/CONNECTION_NOT_FOUND/);
    });

    it('prevents Canary Org B from pausing or syncing Canary Org A connection', async () => {
      const res = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/sync`)
        .set('x-organization-id', orgOtherCanary)
        .set('x-user-id', 'usr_other_b');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // 5. OAUTH FLOW & CONNECTION LIFECYCLE
  // ==========================================================================
  describe('OAuth Flow & Lifecycle Management', () => {
    it('initiates OAuth flow with signed state nonce and official read-only scope URL', async () => {
      const res = await request(app)
        .post('/api/integrations/oauth/initiate')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin)
        .send({
          provider_type: 'youtube',
          subject_id: subjectCanaryId
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.state).toBeDefined();
      expect(res.body.data.authorization_url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(res.body.data.authorization_url).toContain('https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly');
    });

    it('completes OAuth callback with valid state and mock authorization code', async () => {
      // 1. Initiate to generate state
      const initRes = await request(app)
        .post('/api/integrations/oauth/initiate')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin)
        .send({
          provider_type: 'youtube',
          subject_id: subjectCanaryId
        });

      const stateToken = initRes.body.data.state;

      // 2. Complete callback
      const cbRes = await request(app)
        .post('/api/integrations/oauth/callback')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin)
        .send({
          provider_type: 'youtube',
          code: 'mock_valid_auth_code_001',
          state: stateToken
        });

      expect(cbRes.status).toBe(201);
      expect(cbRes.body.success).toBe(true);
      expect(cbRes.body.data.id).toBeDefined();
      expect(cbRes.body.data.status).toBe('connected');
      expect(cbRes.body.data.account_id).toBe('UC_mock_channel_doctor_rao_01');

      // Tokens must not be exposed in return body
      expect(cbRes.body.data.encrypted_access_token).toBeUndefined();
    });

    it('pauses, resumes, and syncs connection', async () => {
      // Pause
      const pauseRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/pause`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(pauseRes.status).toBe(200);

      const pausedConn = db.prepare('SELECT is_paused FROM provider_connections WHERE id = ?').get(connectionCanaryId) as any;
      expect(pausedConn.is_paused).toBe(1);

      // Attempt sync while paused -> fails with 400
      const syncPausedRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/sync`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(syncPausedRes.status).toBe(400);

      // Resume
      const resumeRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/resume`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(resumeRes.status).toBe(200);

      // Manual Sync while active
      const syncActiveRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/sync`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(syncActiveRes.status).toBe(200);
      expect(syncActiveRes.body.data.status).toBe('synced');
    });

    it('disconnects connection: wipes stored tokens and removes sync cursors', async () => {
      const discRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/disconnect`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(discRes.status).toBe(200);

      const connRow = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(connectionCanaryId) as any;
      expect(connRow.status).toBe('disconnected');
      expect(connRow.encrypted_access_token).toBeNull();
      expect(connRow.encrypted_refresh_token).toBeNull();
    });
  });

  // ==========================================================================
  // 6. GLOBAL EMERGENCY KILL SWITCH
  // ==========================================================================
  describe('Global Emergency Kill Switch', () => {
    it('restricts kill switch toggle to admin / system_admin roles', async () => {
      // Analyst attempt -> 403
      const analystRes = await request(app)
        .post('/api/integrations/kill-switch')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAnalyst)
        .send({ active: true });

      expect(analystRes.status).toBe(403);

      // Admin attempt -> 200
      const adminRes = await request(app)
        .post('/api/integrations/kill-switch')
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin)
        .send({ active: true });

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.kill_switch_active).toBe(true);

      // Verify sync is immediately halted
      const syncRes = await request(app)
        .post(`/api/integrations/connections/${connectionCanaryId}/sync`)
        .set('x-organization-id', orgCanary)
        .set('x-user-id', userCanaryAdmin);

      expect(syncRes.body.data.status).toBe('skipped_paused');
      expect(syncRes.body.data.error).toMatch(/KILL_SWITCH_ACTIVE/);
    });
  });
});
