import crypto from 'crypto';
import {
  ProviderAdapter,
  ProviderAuthTokens,
  ProviderAccountProfile,
  FetchItemsResult,
  WebhookValidationResult
} from './provider-adapter-interface.js';
import {
  ProviderConnection,
  ProviderCursor,
  ProviderSignal,
  ProviderType
} from '../../domain/types.js';

export interface YouTubeAdapterConfig {
  clientId?: string;
  clientSecret?: string;
  isMockMode?: boolean;
}

/**
 * YouTubeReadOnlyAdapter
 * Implements read-only interaction with YouTube Data API v3 and Google WebSub (PubSubHubbub).
 * Strictly read-only: Zero write, upload, delete, or commenting operations.
 */
export class YouTubeReadOnlyAdapter implements ProviderAdapter {
  public readonly providerType: ProviderType = 'youtube';
  public readonly isReadOnly: boolean = true;
  public readonly defaultScopes: string[] = [
    'https://www.googleapis.com/auth/youtube.readonly'
  ];

  private clientId: string;
  private clientSecret: string;
  private isMockMode: boolean;

  constructor(config?: YouTubeAdapterConfig) {
    this.clientId = config?.clientId || process.env.YOUTUBE_CLIENT_ID || 'mock_yt_client_id';
    this.clientSecret = config?.clientSecret || process.env.YOUTUBE_CLIENT_SECRET || 'mock_yt_client_secret';
    this.isMockMode = config?.isMockMode ?? (process.env.NODE_ENV === 'test' || !process.env.YOUTUBE_CLIENT_SECRET);
  }

  /**
   * Generates Google OAuth 2.0 authorization URL with least-privilege scope
   */
  public getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.defaultScopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for tokens
   */
  public async exchangeCode(code: string, redirectUri: string): Promise<ProviderAuthTokens> {
    if (this.isMockMode || code.startsWith('mock_') || code.startsWith('test_')) {
      return {
        accessToken: `ya29.mock_access_token_${crypto.randomBytes(16).toString('hex')}`,
        refreshToken: `1//mock_refresh_token_${crypto.randomBytes(16).toString('hex')}`,
        expiresInSeconds: 3600,
        tokenType: 'Bearer',
        scopes: this.defaultScopes
      };
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOUTUBE_OAUTH_EXCHANGE_FAILED: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: data.expires_in || 3600,
      tokenType: data.token_type || 'Bearer',
      scopes: data.scope ? data.scope.split(' ') : this.defaultScopes
    };
  }

  /**
   * Refreshes expired access tokens
   */
  public async refreshToken(refreshToken: string): Promise<ProviderAuthTokens> {
    if (this.isMockMode || refreshToken.includes('mock_') || refreshToken.includes('test_')) {
      return {
        accessToken: `ya29.mock_refreshed_access_${crypto.randomBytes(16).toString('hex')}`,
        refreshToken,
        expiresInSeconds: 3600,
        tokenType: 'Bearer',
        scopes: this.defaultScopes
      };
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOUTUBE_TOKEN_REFRESH_FAILED: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresInSeconds: data.expires_in || 3600,
      tokenType: data.token_type || 'Bearer',
      scopes: data.scope ? data.scope.split(' ') : this.defaultScopes
    };
  }

  /**
   * Retrieves authenticated channel profile information
   */
  public async getAccountProfile(accessToken: string): Promise<ProviderAccountProfile> {
    if (this.isMockMode || accessToken.includes('mock_') || accessToken.includes('test_')) {
      return {
        accountId: 'UC_mock_channel_doctor_rao_01',
        accountName: 'Dr. Ananya Rao Official Clinic',
        accountEmail: 'contact@dra-rao-clinic.example',
        customUrl: '@DrAnanyaRaoClinic',
        avatarUrl: 'https://images.example/channel/avatar_rao.jpg',
        rawDetails: {
          uploadsPlaylistId: 'UU_mock_channel_doctor_rao_01',
          subscriberCount: 125000,
          videoCount: 84
        }
      };
    }

    const url = 'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true';
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOUTUBE_PROFILE_FETCH_FAILED: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    const item = data.items?.[0];
    if (!item) {
      throw new Error('YOUTUBE_CHANNEL_NOT_FOUND: No YouTube channel found for authenticated Google account');
    }

    return {
      accountId: item.id,
      accountName: item.snippet?.title || 'YouTube Channel',
      customUrl: item.snippet?.customUrl,
      avatarUrl: item.snippet?.thumbnails?.default?.url,
      rawDetails: {
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
        viewCount: item.statistics?.viewCount,
        subscriberCount: item.statistics?.subscriberCount,
        videoCount: item.statistics?.videoCount
      }
    };
  }

  /**
   * Incremental pull of channel's uploaded items using cursors
   */
  public async fetchRecentItems(
    connection: ProviderConnection,
    accessToken: string,
    cursor?: ProviderCursor | null,
    limit: number = 20
  ): Promise<FetchItemsResult> {
    if (this.isMockMode || accessToken.includes('mock_') || accessToken.includes('test_')) {
      const now = new Date();
      const mockSignals: ProviderSignal[] = [
        {
          provider_type: 'youtube',
          provider_item_id: 'vid_yt_mock_001',
          external_url: 'https://www.youtube.com/watch?v=vid_yt_mock_001',
          title: 'Dr. Ananya Rao Official Clinic - Cardiac Wellness Guidance',
          description: 'Official clinical health guidance. Authorized medical advice.',
          published_at: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
          channel_id: connection.account_id || 'UC_mock_channel_doctor_rao_01',
          channel_title: connection.account_name || 'Dr. Ananya Rao Official Clinic',
          content_type: 'video',
          raw_metadata: {
            videoId: 'vid_yt_mock_001',
            channelId: connection.account_id || 'UC_mock_channel_doctor_rao_01',
            isOfficialFeed: true
          }
        }
      ];

      return {
        signals: mockSignals,
        nextCursor: 'mock_next_page_token_123',
        hasMore: false,
        totalFetched: mockSignals.length
      };
    }

    const uploadsPlaylistId = connection.metadata?.uploadsPlaylistId || `UU${connection.account_id?.slice(2)}`;
    const pageToken = cursor?.last_cursor || '';
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', uploadsPlaylistId);
    url.searchParams.set('maxResults', String(Math.min(limit, 50)));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOUTUBE_PLAYLIST_FETCH_FAILED: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    const items = data.items || [];
    const signals: ProviderSignal[] = items.map((item: any) => {
      const videoId = item.snippet?.resourceId?.videoId || item.id;
      return {
        provider_type: 'youtube',
        provider_item_id: videoId,
        external_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        published_at: item.snippet?.publishedAt || new Date().toISOString(),
        channel_id: item.snippet?.channelId || connection.account_id || '',
        channel_title: item.snippet?.channelTitle || connection.account_name || '',
        content_type: 'video',
        raw_metadata: {
          videoId,
          thumbnails: item.snippet?.thumbnails,
          position: item.snippet?.position
        }
      };
    });

    return {
      signals,
      nextCursor: data.nextPageToken || null,
      hasMore: !!data.nextPageToken,
      totalFetched: signals.length
    };
  }

  /**
   * Searches public YouTube candidate signals matching authorized subject names/handles
   * Strictly read-only public search API, zero web scraping
   */
  public async searchSubjectCandidates(
    _connection: ProviderConnection,
    accessToken: string,
    query: string,
    cursor?: string | null,
    limit: number = 10
  ): Promise<FetchItemsResult> {
    if (this.isMockMode || accessToken.includes('mock_') || accessToken.includes('test_')) {
      const now = new Date();
      const mockSignals: ProviderSignal[] = [
        {
          provider_type: 'youtube',
          provider_item_id: 'vid_yt_lookalike_002',
          external_url: 'https://www.youtube.com/watch?v=vid_yt_lookalike_002',
          title: `Secret Cure Endorsement by ${query} - Urgent Purchase Link`,
          description: `Watch Dr. Rao reveal secret miracle herbal medicine. Wire transfer UPI required.`,
          published_at: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
          channel_id: 'UC_impersonator_fraud_999',
          channel_title: `${query} Miracle Support`,
          content_type: 'video',
          raw_metadata: {
            videoId: 'vid_yt_lookalike_002',
            channelId: 'UC_impersonator_fraud_999',
            isCandidateLookalike: true
          }
        }
      ];

      return {
        signals: mockSignals,
        nextCursor: null,
        hasMore: false,
        totalFetched: mockSignals.length
      };
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(limit, 25)));
    if (cursor) {
      url.searchParams.set('pageToken', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`YOUTUBE_SEARCH_FAILED: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    const items = data.items || [];
    const signals: ProviderSignal[] = items.map((item: any) => {
      const videoId = item.id?.videoId || item.id;
      return {
        provider_type: 'youtube',
        provider_item_id: videoId,
        external_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        published_at: item.snippet?.publishedAt || new Date().toISOString(),
        channel_id: item.snippet?.channelId || '',
        channel_title: item.snippet?.channelTitle || '',
        content_type: 'video',
        raw_metadata: {
          videoId,
          thumbnails: item.snippet?.thumbnails,
          channelId: item.snippet?.channelId
        }
      };
    });

    return {
      signals,
      nextCursor: data.nextPageToken || null,
      hasMore: !!data.nextPageToken,
      totalFetched: signals.length
    };
  }

  /**
   * Validates and parses Google WebSub (PubSubHubbub) webhook feeds with HMAC signature verification
   * XXE-safe, entity-expansion-disabled XML parsing
   */
  public async validateAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    secret: string,
    query?: Record<string, any>
  ): Promise<WebhookValidationResult> {
    // 1. Check for WebSub GET verification challenge handshake
    if (query && query['hub.challenge']) {
      const mode = query['hub.mode'];
      if (mode !== 'subscribe' && mode !== 'unsubscribe') {
        return { isValid: false, reason: 'WEBSUB_INVALID_MODE: hub.mode must be subscribe or unsubscribe' };
      }
      return {
        isValid: true,
        challengeResponse: query['hub.challenge']
      };
    }

    // 2. Check X-Hub-Signature header for POST event notifications
    const rawSig = (headers['x-hub-signature'] || headers['x-hub-signature-256']) as string | undefined;
    if (!rawSig) {
      return { isValid: false, reason: 'WEBSUB_MISSING_SIGNATURE: X-Hub-Signature header required' };
    }

    const [algo, signature] = rawSig.split('=');
    if (!algo || !signature) {
      return { isValid: false, reason: 'WEBSUB_MALFORMED_SIGNATURE: Format must be algo=signature' };
    }

    const hashAlgo = algo.toLowerCase() === 'sha256' ? 'sha256' : 'sha1';
    const hmac = crypto.createHmac(hashAlgo, secret).update(rawBody).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const hmacBuf = Buffer.from(hmac, 'hex');

    if (sigBuf.length !== hmacBuf.length || !crypto.timingSafeEqual(sigBuf, hmacBuf)) {
      return { isValid: false, reason: 'WEBSUB_SIGNATURE_MISMATCH: HMAC verification failed' };
    }

    // 3. Safe, zero-entity XML Parsing using targeted regex (neutralizing XXE/DTD injection attacks)
    const xmlContent = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    // Extract videoId, channelId, title, and link
    const videoIdMatch = xmlContent.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const channelIdMatch = xmlContent.match(/<yt:channelId>([^<]+)<\/yt:channelId>/);
    const titleMatch = xmlContent.match(/<title>([^<]+)<\/title>/g); // usually feed title then entry title
    const entryTitle = titleMatch && titleMatch.length > 1
      ? titleMatch[1].replace(/<\/?title>/g, '')
      : (titleMatch?.[0]?.replace(/<\/?title>/g, '') || 'YouTube Video');
    const publishedMatch = xmlContent.match(/<published>([^<]+)<\/published>/);
    const authorMatch = xmlContent.match(/<name>([^<]+)<\/name>/);

    if (!videoIdMatch || !channelIdMatch) {
      return { isValid: true, signals: [] }; // Ping/empty feed update
    }

    const videoId = videoIdMatch[1].trim();
    const channelId = channelIdMatch[1].trim();
    const channelTitle = authorMatch ? authorMatch[1].trim() : 'YouTube Channel';
    let publishedAt = new Date().toISOString();
    if (publishedMatch) {
      try {
        const parsedDate = new Date(publishedMatch[1].trim());
        if (!isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate.toISOString();
        }
      } catch {
        publishedAt = new Date().toISOString();
      }
    }

    const signal: ProviderSignal = {
      provider_type: 'youtube',
      provider_item_id: videoId,
      external_url: `https://www.youtube.com/watch?v=${videoId}`,
      title: entryTitle,
      description: 'WebSub real-time channel feed event',
      published_at: publishedAt,
      channel_id: channelId,
      channel_title: channelTitle,
      content_type: 'video',
      raw_metadata: {
        videoId,
        channelId,
        source: 'websub_push',
        publishedAt
      }
    };

    return {
      isValid: true,
      signals: [signal]
    };
  }
}

export { YouTubeReadOnlyAdapter as YouTubeAdapter };
