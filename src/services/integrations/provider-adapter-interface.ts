import {
  ProviderConnection,
  ProviderCursor,
  ProviderSignal,
  ProviderType
} from '../../domain/types.js';

export interface ProviderAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  tokenType?: string;
  scopes: string[];
}

export interface ProviderAccountProfile {
  accountId: string; // e.g. Channel ID
  accountName: string; // e.g. Channel Title
  accountEmail?: string;
  customUrl?: string;
  avatarUrl?: string;
  rawDetails: Record<string, any>;
}

export interface FetchItemsResult {
  signals: ProviderSignal[];
  nextCursor?: string | null;
  hasMore: boolean;
  totalFetched: number;
}

export interface WebhookValidationResult {
  isValid: boolean;
  reason?: string;
  signals?: ProviderSignal[];
  challengeResponse?: string;
}

/**
 * ProviderAdapterInterface
 * Provider-neutral contract decoupling core desk monitoring from individual external platforms.
 */
export interface ProviderAdapter {
  readonly providerType: ProviderType;
  readonly isReadOnly: boolean;
  readonly defaultScopes: string[];

  /**
   * Generates official authorization URL for customer consent
   */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /**
   * Exchanges authorization code for tokens
   */
  exchangeCode(code: string, redirectUri: string): Promise<ProviderAuthTokens>;

  /**
   * Refreshes expired access tokens
   */
  refreshToken(refreshToken: string): Promise<ProviderAuthTokens>;

  /**
   * Retrieves authenticated profile information
   */
  getAccountProfile(accessToken: string): Promise<ProviderAccountProfile>;

  /**
   * Incremental pull of recent public items (videos, posts, uploads)
   */
  fetchRecentItems(
    connection: ProviderConnection,
    accessToken: string,
    cursor?: ProviderCursor | null,
    limit?: number
  ): Promise<FetchItemsResult>;

  /**
   * Searches public platform candidates matching authorized subject names/handles
   * NOTE: Strictly read-only public search, zero web scraping
   */
  searchSubjectCandidates(
    connection: ProviderConnection,
    accessToken: string,
    query: string,
    cursor?: string | null,
    limit?: number
  ): Promise<FetchItemsResult>;

  /**
   * Validates and parses incoming webhooks (e.g. WebSub / PubSubHubbub)
   */
  validateAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    secret: string,
    query?: Record<string, any>
  ): Promise<WebhookValidationResult>;
}
