import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { YouTubeReadOnlyAdapter } from '../../src/services/integrations/youtube-adapter.js';
import { ProviderConnection } from '../../src/domain/types.js';

describe('Unit: YouTube Read-Only Provider Adapter', () => {
  const adapter = new YouTubeReadOnlyAdapter({ isMockMode: true });

  const mockConnection: ProviderConnection = {
    id: 'conn_test_yt_01',
    organization_id: 'org_test_yt_01',
    provider_type: 'youtube',
    status: 'connected',
    account_id: 'UC_mock_channel_doctor_rao_01',
    account_name: 'Dr. Ananya Rao Official Clinic',
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    error_count: 0,
    is_canary: 1,
    is_paused: 0,
    metadata: {},
    created_by_user_id: 'usr_test_yt_01',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  it('guarantees strictly read-only capabilities and least-privilege scopes', () => {
    expect(adapter.isReadOnly).toBe(true);
    expect(adapter.defaultScopes).toEqual(['https://www.googleapis.com/auth/youtube.readonly']);

    // Ensure no write, upload, or delete scopes are present
    expect(adapter.defaultScopes).not.toContain('https://www.googleapis.com/auth/youtube');
    expect(adapter.defaultScopes).not.toContain('https://www.googleapis.com/auth/youtube.upload');
    expect(adapter.defaultScopes).not.toContain('https://www.googleapis.com/auth/youtube.force-ssl');
  });

  it('generates standard Google OAuth 2.0 authorization URL with state parameter', () => {
    const state = 'test_state_nonce_12345';
    const redirect = 'https://desk.example.in/oauth/callback';
    const urlStr = adapter.getAuthorizationUrl(state, redirect);
    const url = new URL(urlStr);

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('redirect_uri')).toBe(redirect);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('fetches authenticated channel profile information in mock mode', async () => {
    const profile = await adapter.getAccountProfile('mock_access_token_123');

    expect(profile.accountId).toBe('UC_mock_channel_doctor_rao_01');
    expect(profile.accountName).toContain('Dr. Ananya Rao');
    expect(profile.accountEmail).toBe('contact@dra-rao-clinic.example');
    expect(profile.rawDetails).toBeDefined();
  });

  it('fetches incremental channel uploads and normalizes to ProviderSignal', async () => {
    const result = await adapter.fetchRecentItems(mockConnection, 'mock_access_token_123');

    expect(result.signals.length).toBeGreaterThan(0);
    const signal = result.signals[0];
    expect(signal.provider_type).toBe('youtube');
    expect(signal.content_type).toBe('video');
    expect(signal.external_url).toContain('https://www.youtube.com/watch?v=');
    expect(signal.title).toContain('Dr. Ananya Rao');
  });

  it('searches candidate videos matching subject and normalizes lookalikes', async () => {
    const result = await adapter.searchSubjectCandidates(mockConnection, 'mock_access_token_123', 'Dr. Ananya Rao');

    expect(result.signals.length).toBeGreaterThan(0);
    const candidate = result.signals[0];
    expect(candidate.provider_type).toBe('youtube');
    expect(candidate.content_type).toBe('video');
    expect(candidate.raw_metadata.isCandidateLookalike).toBe(true);
  });

  it('verifies WebSub GET verification challenge handshake', async () => {
    const challenge = 'challenge_token_abc_123';
    const query = {
      'hub.mode': 'subscribe',
      'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC123',
      'hub.challenge': challenge
    };

    const res = await adapter.validateAndParseWebhook({}, '', 'secret_key', query);
    expect(res.isValid).toBe(true);
    expect(res.challengeResponse).toBe(challenge);
  });

  it('verifies WebSub POST HMAC signature and safely extracts video updates without XXE', async () => {
    const secret = 'partner_secret_key_32_bytes_long';
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="is" href="http://www.youtube.com"/>
  <title>YouTube video feed</title>
  <entry>
    <id>yt:video:vid_event_999</id>
    <yt:videoId>vid_event_999</yt:videoId>
    <yt:channelId>UC_mock_channel_doctor_rao_01</yt:channelId>
    <title>New Health Seminar Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vid_event_999"/>
    <author>
      <name>Dr. Ananya Rao Official Clinic</name>
    </author>
    <published>2026-09-13T12:00:00+00:00</published>
  </entry>
</feed>`;

    const hmac = crypto.createHmac('sha1', secret).update(sampleXml).digest('hex');
    const headers = { 'x-hub-signature': `sha1=${hmac}` };

    const res = await adapter.validateAndParseWebhook(headers, sampleXml, secret);
    expect(res.isValid).toBe(true);
    expect(res.signals).toBeDefined();
    expect(res.signals!.length).toBe(1);

    const sig = res.signals![0];
    expect(sig.provider_item_id).toBe('vid_event_999');
    expect(sig.external_url).toBe('https://www.youtube.com/watch?v=vid_event_999');
    expect(sig.title).toBe('New Health Seminar Video');
  });

  it('rejects WebSub POST requests with invalid or missing HMAC signatures', async () => {
    const secret = 'valid_secret';
    const sampleXml = '<feed></feed>';

    // Missing signature
    const res1 = await adapter.validateAndParseWebhook({}, sampleXml, secret);
    expect(res1.isValid).toBe(false);
    expect(res1.reason).toContain('WEBSUB_MISSING_SIGNATURE');

    // Invalid signature
    const res2 = await adapter.validateAndParseWebhook(
      { 'x-hub-signature': 'sha1=invalid_hmac_hex' },
      sampleXml,
      secret
    );
    expect(res2.isValid).toBe(false);
    expect(res2.reason).toContain('WEBSUB_SIGNATURE_MISMATCH');
  });
});
