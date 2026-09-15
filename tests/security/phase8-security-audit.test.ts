import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { ProviderSyncService } from '../../src/services/integrations/provider-sync-service.js';
import { TokenEncryption } from '../../src/services/integrations/token-encryption.js';
import { WebhookService } from '../../src/services/integrations/webhook-service.js';
import { WorkerManager } from '../../src/workers/worker-manager.js';

describe('Security Audit: Phase 8 Controlled Read-Only Integrations Hardening', () => {
  let app: any;
  let db: Database.Database;

  const orgCanaryA = 'org_audit_canary_a';
  const orgCanaryB = 'org_audit_canary_b';
  const orgStandard = 'org_audit_standard_c';

  const userCanaryAdminA = 'usr_audit_admin_a';
  const userCanaryAdminB = 'usr_audit_admin_b';
  const userStandardAdmin = 'usr_audit_admin_c';

  const subjectAId = 'subj_audit_a';
  const connectionAId = 'conn_audit_yt_a';

  beforeEach(() => {
    ProviderSyncService.setGlobalKillSwitch(false);

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);
    setDatabaseInstance(db);

    // Seed Organizations
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Canary Hospital Alpha', 'canary-hospital-a', 'healthcare', 'IN-DL', 'admin@alpha.in'),
             (?, 'Canary Media Beta', 'canary-media-b', 'media', 'IN-MH', 'admin@beta.in'),
             (?, 'Standard Retail Gamma', 'standard-retail-c', 'commerce', 'IN-KA', 'admin@gamma.in')
    `).run(orgCanaryA, orgCanaryB, orgStandard);

    // Seed Users
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'admin@alpha.in', 'Alpha Admin', 'pw'),
             (?, 'admin@beta.in', 'Beta Admin', 'pw'),
             (?, 'admin@gamma.in', 'Gamma Admin', 'pw')
    `).run(userCanaryAdminA, userCanaryAdminB, userStandardAdmin);

    // Seed Memberships
    db.prepare(`
      INSERT INTO memberships (id, user_id, organization_id, role)
      VALUES ('mem_a', ?, ?, 'org_admin'),
             ('mem_b', ?, ?, 'org_admin'),
             ('mem_c', ?, ?, 'org_admin')
    `).run(userCanaryAdminA, orgCanaryA, userCanaryAdminB, orgCanaryB, userStandardAdmin, orgStandard);

    // Seed Canary Entitlements
    db.prepare(`
      INSERT INTO pilot_entitlements (
        id, organization_id, pilot_start_date, pilot_end_date,
        is_integration_canary_enabled, max_provider_connections
      ) VALUES
        ('ent_a', ?, '2026-01-01', '2026-12-31', 1, 3),
        ('ent_b', ?, '2026-01-01', '2026-12-31', 1, 3),
        ('ent_c', ?, '2026-01-01', '2026-12-31', 0, 0)
    `).run(orgCanaryA, orgCanaryB, orgStandard);

    // Seed Subject with Active Mandate
    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, monitoring_status, created_by_user_id
      ) VALUES (?, ?, 'doctor', 'Dr. Ananya Roy', 'client_representation_agreement', 'REF-MANDATE-2026-A', 'active', ?)
    `).run(subjectAId, orgCanaryA, userCanaryAdminA);

    // Seed Provider Connection for Org A
    const encAccessToken = TokenEncryption.encrypt('ya29.test_access_token_123');
    const encRefreshToken = TokenEncryption.encrypt('1//0g_test_refresh_token_456');

    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        account_email, scopes, encrypted_access_token, encrypted_refresh_token,
        token_expires_at, is_canary, is_paused, metadata, created_by_user_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, 'youtube', 'connected', 'UC_alpha_channel_123', 'Dr. Ananya Official',
        'ananya@alpha.in', '["https://www.googleapis.com/auth/youtube.readonly"]',
        ?, ?, '2027-01-01T00:00:00.000Z', 1, 0, '{}', ?, '2026-09-13T10:00:00.000Z', '2026-09-13T10:00:00.000Z'
      )
    `).run(connectionAId, orgCanaryA, encAccessToken, encRefreshToken, userCanaryAdminA);

    // Map Subject to Connection
    db.prepare(`
      INSERT INTO provider_connection_subjects (id, connection_id, subject_id, created_at)
      VALUES ('pcs_a', ?, ?, '2026-09-13T10:00:00.000Z')
    `).run(connectionAId, subjectAId);

    // Seed Circuit State
    db.prepare(`
      INSERT INTO provider_circuit_states (
        connection_id, circuit_state, failure_count, updated_at
      ) VALUES (?, 'closed', 0, '2026-09-13T10:00:00.000Z')
    `).run(connectionAId);

    // Seed WebSub Subscription
    const webhookSecret = 'test_webhook_secret_0123456789abcdef';
    const secretHash = crypto.createHash('sha256').update(webhookSecret).digest('hex');

    db.prepare(`
      INSERT INTO provider_webhook_subscriptions (
        id, connection_id, topic_url, hub_url, secret_hash, lease_seconds, status, created_at, updated_at
      ) VALUES (
        'sub_yt_a', ?, 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC_alpha_channel_123',
        'https://pubsubhubbub.appspot.com', ?, 86400, 'verified', '2026-09-13T10:00:00.000Z', '2026-09-13T10:00:00.000Z'
      )
    `).run(connectionAId, secretHash);

    app = createApp();
  });

  afterEach(() => {
    ProviderSyncService.setGlobalKillSwitch(false);
    closeDatabase();
  });

  it('Requirement A: Enforces strict multi-tenant isolation across all connection operations', async () => {
    // 1. Org B tries to access Org A's connection details -> 404
    const getRes = await request(app)
      .get(`/api/integrations/connections/${connectionAId}`)
      .set('x-organization-id', orgCanaryB)
      .set('x-user-id', userCanaryAdminB);
    expect(getRes.status).toBe(404);

    // 2. Org B tries to trigger sync on Org A's connection -> 404
    const syncRes = await request(app)
      .post(`/api/integrations/connections/${connectionAId}/sync`)
      .set('x-organization-id', orgCanaryB)
      .set('x-user-id', userCanaryAdminB);
    expect(syncRes.status).toBe(404);

    // 3. Org B tries to pause Org A's connection -> 404
    const pauseRes = await request(app)
      .post(`/api/integrations/connections/${connectionAId}/pause`)
      .set('x-organization-id', orgCanaryB)
      .set('x-user-id', userCanaryAdminB);
    expect(pauseRes.status).toBe(404);

    // 4. Org B tries to update subject mappings on Org A's connection -> 404
    const mapRes = await request(app)
      .put(`/api/integrations/connections/${connectionAId}/subjects`)
      .set('x-organization-id', orgCanaryB)
      .set('x-user-id', userCanaryAdminB)
      .send({ subject_ids: [subjectAId] });
    expect(mapRes.status).toBe(404);

    // 5. Org B tries to disconnect Org A's connection -> 404
    const disconnectRes = await request(app)
      .post(`/api/integrations/connections/${connectionAId}/disconnect`)
      .set('x-organization-id', orgCanaryB)
      .set('x-user-id', userCanaryAdminB);
    expect(disconnectRes.status).toBe(404);

    // 6. Non-canary tenant tries to list connections -> 403 Forbidden
    const nonCanaryRes = await request(app)
      .get('/api/integrations/connections')
      .set('x-organization-id', orgStandard)
      .set('x-user-id', userStandardAdmin);
    expect(nonCanaryRes.status).toBe(403);
    expect(nonCanaryRes.body.error).toContain('INTEGRATION_CANARY_DISABLED');
  });

  it('Requirement B: Verifies zero token, secret, IV, or auth tag leakage in all API payloads', async () => {
    // 1. Check GET /connections list
    const listRes = await request(app)
      .get('/api/integrations/connections')
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA);
    expect(listRes.status).toBe(200);

    const listJson = JSON.stringify(listRes.body);
    expect(listJson).not.toContain('encrypted_tokens');
    expect(listJson).not.toContain('token_iv');
    expect(listJson).not.toContain('token_auth_tag');
    expect(listJson).not.toContain('encrypted_secret');
    expect(listJson).not.toContain('secret_iv');
    expect(listJson).not.toContain('secret_auth_tag');
    expect(listJson).not.toContain('secret_hash');
    expect(listJson).not.toContain('1//0g_test_refresh_token');
    expect(listJson).not.toContain('ya29.test_access_token');
    expect(listJson).not.toContain('test_webhook_secret');

    // 2. Check GET /connections/:id detail
    const detailRes = await request(app)
      .get(`/api/integrations/connections/${connectionAId}`)
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA);
    expect(detailRes.status).toBe(200);

    const detailJson = JSON.stringify(detailRes.body);
    expect(detailJson).not.toContain('encrypted_tokens');
    expect(detailJson).not.toContain('token_iv');
    expect(detailJson).not.toContain('token_auth_tag');
    expect(detailJson).not.toContain('1//0g_test_refresh_token');
    expect(detailJson).not.toContain('ya29.test_access_token');

    // Verify sanitized structure
    const conn = detailRes.body.data.connection;
    expect(conn.id).toBe(connectionAId);
    expect(conn.account_id).toBe('UC_alpha_channel_123');
    expect(conn.encrypted_access_token).toBeUndefined();
    expect(conn.encrypted_refresh_token).toBeUndefined();
  });

  it('Requirement C: Validates emergency kill switch instantly halts polling and public webhooks with 503', async () => {
    // Arm kill switch
    const armRes = await request(app)
      .post('/api/integrations/kill-switch')
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA)
      .send({
        active: true,
        reason: 'Emergency security audit active — suspend all ingestion'
      });
    expect(armRes.status).toBe(200);
    expect(armRes.body.data.kill_switch_active).toBe(true);

    // Check GET status reflects kill switch
    const statusRes = await request(app)
      .get('/api/integrations/status')
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.kill_switch_active).toBe(true);

    // Attempt manual sync -> returns skipped_paused with KILL_SWITCH_ACTIVE
    const syncRes = await request(app)
      .post(`/api/integrations/connections/${connectionAId}/sync`)
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA);
    expect(syncRes.body.data.status).toBe('skipped_paused');
    expect(syncRes.body.data.error).toContain('KILL_SWITCH_ACTIVE');

    // Attempt public WebSub push -> 503 Service Unavailable
    const webhookRes = await request(app)
      .post(`/api/integrations/youtube/webhook/${connectionAId}`)
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', 'sha1=abcdef1234567890')
      .send('<feed><entry><title>Lookalike test</title></entry></feed>');
    expect(webhookRes.status).toBe(503);
    expect(webhookRes.body.error).toContain('kill-switch');

    // Disarm kill switch
    await request(app)
      .post('/api/integrations/kill-switch')
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA)
      .send({
        active: false,
        reason: 'Audit complete — resume normal operations'
      });

    // WebSub GET challenge verification succeeds once disarmed
    const getWebhookRes = await request(app)
      .get(`/api/integrations/youtube/webhook/${connectionAId}`)
      .query({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC_alpha_channel_123',
        'hub.challenge': 'audit_challenge_token_xyz',
        'hub.lease_seconds': 86400
      });
    expect(getWebhookRes.status).toBe(200);
    expect(getWebhookRes.text).toBe('audit_challenge_token_xyz');
  });

  it('Requirement D: Guarantees human_review_mandatory=1 and zero automated case/takedown creation', async () => {
    // Deliver authentic WebSub XML push payload
    const rawXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <id>yt:video:audit_vid_999</id>
    <yt:videoId>audit_vid_999</yt:videoId>
    <yt:channelId>UC_alpha_channel_123</yt:channelId>
    <title>Dr. Ananya Roy Clinic Scams Exposed Warning</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=audit_vid_999"/>
    <author><name>Deepfake Investigation Hub</name></author>
    <published>2026-09-13T10:00:00Z</published>
    <updated>2026-09-13T10:00:00Z</updated>
  </entry>
</feed>`;

    // Compute valid HMAC-SHA1 signature using test secret
    const webhookService = new WebhookService(db);
    const webhookSecret = webhookService.getWebhookSecret(connectionAId);
    const signature = crypto.createHmac('sha1', webhookSecret).update(rawXml).digest('hex');

    const res = await request(app)
      .post(`/api/integrations/youtube/webhook/${connectionAId}`)
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', `sha1=${signature}`)
      .send(rawXml);

    expect(res.status).toBe(200);
    expect(res.body.received_signals).toBe(1);
    expect(res.body.ingested_count).toBe(1);

    // Verify in candidate_reviews table
    const review = db.prepare(`
      SELECT * FROM candidate_reviews WHERE organization_id = ?
    `).get(orgCanaryA) as any;

    expect(review).toBeDefined();
    expect(review.status).toBe('pending');

    // Trigger detection cycle to evaluate candidate signal and populate correlation
    await request(app)
      .post('/api/monitoring/simulate-cycle')
      .set('x-organization-id', orgCanaryA)
      .set('x-user-id', userCanaryAdminA);

    // Verify in candidate_correlations table
    const correlation = db.prepare(`
      SELECT * FROM candidate_correlations WHERE signal_id = ?
    `).get(review.signal_id) as any;

    expect(correlation).toBeDefined();
    expect(correlation.human_review_mandatory).toBe(1);

    // Verify in monitoring_signals table
    const signal = db.prepare(`
      SELECT * FROM monitoring_signals WHERE id = ?
    `).get(review.signal_id) as any;

    expect(signal).toBeDefined();
    expect(signal.adapter_name).toBe('youtube_websub');
    expect(signal.platform).toBe('youtube');
    expect(signal.source_type).toBe('webhook');

    // Verify zero cases were created automatically
    const caseCount = db.prepare(`
      SELECT COUNT(*) as count FROM cases WHERE organization_id = ?
    `).get(orgCanaryA) as any;

    expect(caseCount.count).toBe(0);

    // Verify zero live takedowns were submitted
    const takedownCount = db.prepare(`
      SELECT COUNT(*) as count FROM submissions WHERE organization_id = ?
    `).get(orgCanaryA) as any;

    expect(takedownCount.count).toBe(0);
  });

  it('Requirement E: Purges stale unreferenced candidate signals (>30 days) and expired OAuth nonces', async () => {
    // 1. Seed unreferenced signal from 35 days ago (should be purged)
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_type,
        content_hash, metadata_hash, idempotency_key, raw_payload, created_at, updated_at
      ) VALUES (
        'sig_stale_35d', ?, ?, 'youtube_readonly_adapter', 'external_provider',
        'https://youtube.com/watch?v=stale35', 'https://youtube.com/watch?v=stale35', 'youtube',
        datetime('now', '-35 days'), 'video', 'hash1', 'hash2', 'key_stale_35d', '{}',
        datetime('now', '-35 days'), datetime('now', '-35 days')
      )
    `).run(orgCanaryA, subjectAId);

    db.prepare(`
      INSERT INTO candidate_reviews (id, organization_id, signal_id, status, created_at, updated_at)
      VALUES ('rev_stale_35d', ?, 'sig_stale_35d', 'pending', datetime('now', '-35 days'), datetime('now', '-35 days'))
    `).run(orgCanaryA);

    // 2. Seed recent signal from 5 days ago (should be preserved)
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type,
        observed_url, normalized_url, platform, observed_at, content_type,
        content_hash, metadata_hash, idempotency_key, raw_payload, created_at, updated_at
      ) VALUES (
        'sig_recent_5d', ?, ?, 'youtube_readonly_adapter', 'external_provider',
        'https://youtube.com/watch?v=recent5', 'https://youtube.com/watch?v=recent5', 'youtube',
        datetime('now', '-5 days'), 'video', 'hash3', 'hash4', 'key_recent_5d', '{}',
        datetime('now', '-5 days'), datetime('now', '-5 days')
      )
    `).run(orgCanaryA, subjectAId);

    db.prepare(`
      INSERT INTO candidate_reviews (id, organization_id, signal_id, status, created_at, updated_at)
      VALUES ('rev_recent_5d', ?, 'sig_recent_5d', 'pending', datetime('now', '-5 days'), datetime('now', '-5 days'))
    `).run(orgCanaryA);

    // 3. Seed expired OAuth nonce from 25 hours ago
    db.prepare(`
      INSERT INTO oauth_state_nonces (id, organization_id, user_id, provider_type, state_token, expires_at, created_at)
      VALUES ('non_1', ?, ?, 'youtube', 'token_expired_25h', datetime('now', '-25 hours'), datetime('now', '-25 hours'))
    `).run(orgCanaryA, userCanaryAdminA);

    // 4. Seed fresh OAuth nonce (valid for 10 min)
    db.prepare(`
      INSERT INTO oauth_state_nonces (id, organization_id, user_id, provider_type, state_token, expires_at, created_at)
      VALUES ('non_2', ?, ?, 'youtube', 'token_fresh_10m', datetime('now', '+10 minutes'), datetime('now'))
    `).run(orgCanaryA, userCanaryAdminA);

    // Execute WorkerManager runRetentionWorker()
    const workerManager = new WorkerManager();
    const result = await workerManager.runRetentionWorker();

    expect(result.purgedProviderSignals).toBe(1);
    expect(result.purgedOAuthNonces).toBe(1);

    // Verify 35-day stale candidate signal and review were purged
    const purgedReview = db.prepare(`SELECT * FROM candidate_reviews WHERE id = 'rev_stale_35d'`).get();
    expect(purgedReview).toBeUndefined();

    const purgedSignal = db.prepare(`SELECT * FROM monitoring_signals WHERE id = 'sig_stale_35d'`).get();
    expect(purgedSignal).toBeUndefined();

    // Verify 5-day candidate signal and review remain intact
    const keptReview = db.prepare(`SELECT * FROM candidate_reviews WHERE id = 'rev_recent_5d'`).get();
    expect(keptReview).toBeDefined();

    const keptSignal = db.prepare(`SELECT * FROM monitoring_signals WHERE id = 'sig_recent_5d'`).get();
    expect(keptSignal).toBeDefined();

    // Verify expired nonce was cleaned up, fresh nonce was retained
    const purgedNonce = db.prepare(`SELECT * FROM oauth_state_nonces WHERE id = 'non_1'`).get();
    expect(purgedNonce).toBeUndefined();

    const keptNonce = db.prepare(`SELECT * FROM oauth_state_nonces WHERE id = 'non_2'`).get();
    expect(keptNonce).toBeDefined();
  });
});
