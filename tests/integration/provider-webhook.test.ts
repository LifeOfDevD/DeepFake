import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { WebhookService } from '../../src/services/integrations/webhook-service.js';
import { YouTubeReadOnlyAdapter } from '../../src/services/integrations/youtube-adapter.js';

describe('Integration: Provider WebSub Webhook Security', () => {
  let db: Database.Database;
  let webhookService: WebhookService;
  const adapter = new YouTubeReadOnlyAdapter({ isMockMode: true });

  const orgId = 'org_webhook_test_01';
  const userId = 'usr_webhook_test_01';
  const subjId = 'sub_webhook_test_01';
  const connId = 'conn_webhook_test_01';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);

    // Seed organization, user, entitlement, and subject
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Webhook Org', 'webhook-org', 'healthcare', 'IN-DL', 'wh@example.in')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'wh@example.in', 'Webhook User', 'pw123')
    `).run(userId);

    db.prepare(`
      INSERT INTO pilot_entitlements (id, organization_id, pilot_start_date, pilot_end_date, is_integration_canary_enabled)
      VALUES ('ent_wh_01', ?, '2026-01-01', '2026-12-31', 1)
    `).run(orgId);

    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, created_by_user_id, monitoring_status
      ) VALUES (
        ?, ?, 'doctor', 'Dr. Ananya Rao', 'representation_agreement',
        'AUTH-WH-01', ?, 'active'
      )
    `).run(subjId, orgId, userId);

    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        scopes, is_canary, is_paused, created_by_user_id
      ) VALUES (
        ?, ?, 'youtube', 'connected', 'UC_channel_123', 'Dr. Rao Clinic',
        '["https://www.googleapis.com/auth/youtube.readonly"]', 1, 0, ?
      )
    `).run(connId, orgId, userId);

    db.prepare(`
      INSERT INTO provider_connection_subjects (id, connection_id, subject_id)
      VALUES ('pcs_wh_01', ?, ?)
    `).run(connId, subjId);

    webhookService = new WebhookService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('handles WebSub GET challenge verification and transitions subscription to active', async () => {
    webhookService.registerSubscription(connId, 'https://topic.example');

    const query = {
      'hub.mode': 'subscribe',
      'hub.topic': 'https://topic.example',
      'hub.challenge': 'challenge_random_string_98765'
    };

    const res = await webhookService.handleWebhook(connId, 'GET', {}, '', adapter, query);
    expect(res.statusCode).toBe(200);
    expect(res.responseBody).toBe('challenge_random_string_98765');

    const sub = webhookService.getSubscription(connId);
    expect(sub?.status).toBe('active');
  });

  it('processes valid signed WebSub POST notifications and dispatches signals to candidate reviews', async () => {
    const secret = webhookService.getWebhookSecret(connId);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>vid_websub_live_001</yt:videoId>
    <yt:channelId>UC_channel_123</yt:channelId>
    <title>Dr. Ananya Rao - Health Advice</title>
    <published>2026-09-13T10:00:00Z</published>
  </entry>
</feed>`;

    const hmac = crypto.createHmac('sha1', secret).update(xml).digest('hex');
    const headers = { 'x-hub-signature': `sha1=${hmac}` };

    const res = await webhookService.handleWebhook(connId, 'POST', headers, xml, adapter);
    expect(res.statusCode).toBe(200);
    expect((res.responseBody as any).ingested_count).toBe(1);

    // Verify signal is in monitoring_signals
    const signal = db.prepare(`
      SELECT * FROM monitoring_signals WHERE observed_url = ?
    `).get('https://www.youtube.com/watch?v=vid_websub_live_001') as any;

    expect(signal).toBeDefined();
    expect(signal.source_type).toBe('webhook');
    expect(signal.adapter_name).toBe('youtube_websub');
    expect(signal.platform).toBe('youtube');

    // Verify candidate review queue entry exists and is pending review
    const review = db.prepare(`
      SELECT * FROM candidate_reviews WHERE signal_id = ?
    `).get(signal.id) as any;

    expect(review).toBeDefined();
    expect(review.status).toBe('pending');
  });

  it('rejects POST with invalid HMAC signature with HTTP 401', async () => {
    const xml = '<feed></feed>';
    const headers = { 'x-hub-signature': 'sha1=invalid_fake_signature' };

    const res = await webhookService.handleWebhook(connId, 'POST', headers, xml, adapter);
    expect(res.statusCode).toBe(401);
    expect((res.responseBody as any).error).toContain('WEBSUB_SIGNATURE_MISMATCH');
  });

  it('rejects POST with missing signature header with HTTP 401', async () => {
    const xml = '<feed></feed>';
    const res = await webhookService.handleWebhook(connId, 'POST', {}, xml, adapter);
    expect(res.statusCode).toBe(401);
    expect((res.responseBody as any).error).toContain('WEBSUB_MISSING_SIGNATURE');
  });

  it('rejects payload larger than 1MB with HTTP 413', async () => {
    const largePayload = 'A'.repeat(1024 * 1024 + 10);
    const res = await webhookService.handleWebhook(connId, 'POST', {}, largePayload, adapter);
    expect(res.statusCode).toBe(413);
    expect((res.responseBody as any).error).toContain('PAYLOAD_TOO_LARGE');
  });

  it('rejects webhook requests for disconnected or paused connections with HTTP 403', async () => {
    db.prepare("UPDATE provider_connections SET is_paused = 1 WHERE id = ?").run(connId);

    const res = await webhookService.handleWebhook(connId, 'POST', {}, '<feed></feed>', adapter);
    expect(res.statusCode).toBe(403);
    expect((res.responseBody as any).error).toContain('CONNECTION_INACTIVE');
  });
});
