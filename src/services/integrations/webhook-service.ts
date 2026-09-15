import crypto from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import { getConfig } from '../../config/env.js';
import { ProviderAdapter } from './provider-adapter-interface.js';
import { SignalIngestionService } from '../monitoring/signal-ingestion-service.js';
import { OAuthService } from './oauth-service.js';
import { AuditService } from '../audit-service.js';
import { ProviderWebhookSubscription } from '../../domain/types.js';
import { ProviderSyncService } from './provider-sync-service.js';

export class WebhookService {
  private db: Database.Database;
  private signalIngestionService: SignalIngestionService;
  private oauthService: OAuthService;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.signalIngestionService = new SignalIngestionService(this.db);
    this.oauthService = new OAuthService(this.db);
    this.auditService = new AuditService(this.db);
  }

  /**
   * Generates or retrieves the secret used for WebSub HMAC verification for a connection
   */
  public getWebhookSecret(connectionId: string): string {
    const raw = `${getConfig().auth.sessionSecret}:webhook:${connectionId}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Handles incoming WebSub challenge handshake (GET) or content push (POST)
   */
  public async handleWebhook(
    connectionId: string,
    method: 'GET' | 'POST',
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
    adapter: ProviderAdapter,
    query?: Record<string, any>
  ): Promise<{ statusCode: number; responseBody: string | Record<string, any> }> {
    // 0. Global kill switch check
    if (ProviderSyncService.isGlobalKillSwitchActive()) {
      return { statusCode: 503, responseBody: { error: 'KILL_SWITCH_ACTIVE: Provider webhooks suspended by emergency kill-switch' } };
    }

    // 1. Verify connection exists and is not disconnected
    const connRow = this.db.prepare(`
      SELECT * FROM provider_connections WHERE id = ?
    `).get(connectionId) as any;

    if (!connRow) {
      return { statusCode: 404, responseBody: { error: 'CONNECTION_NOT_FOUND: Unknown webhook connection' } };
    }

    if (connRow.status === 'disconnected' || connRow.is_paused === 1) {
      return { statusCode: 403, responseBody: { error: 'CONNECTION_INACTIVE: Provider connection is paused or disconnected' } };
    }

    // 2. Payload size check (fail-closed against oversized payload bombs)
    const bodySize = Buffer.isBuffer(rawBody) ? rawBody.length : Buffer.byteLength(rawBody || '');
    if (bodySize > 1024 * 1024) { // 1 MB limit
      return { statusCode: 413, responseBody: { error: 'PAYLOAD_TOO_LARGE: Webhook body exceeds 1MB limit' } };
    }

    const secret = this.getWebhookSecret(connectionId);

    // 3. Process with provider adapter
    const validation = await adapter.validateAndParseWebhook(headers, rawBody, secret, query);

    if (!validation.isValid) {
      this.auditService.record({
        organization_id: connRow.organization_id,
        actor_user_id: 'system_webhook',
        actor_email: 'system@webhook.internal',
        action: 'webhook_verification_failed',
        resource_type: 'provider_connection',
        resource_id: connectionId,
        details: { reason: validation.reason, method }
      });

      return {
        statusCode: 401,
        responseBody: { error: validation.reason || 'INVALID_WEBHOOK_SIGNATURE' }
      };
    }

    // 4. Handle GET challenge response
    if (method === 'GET' && validation.challengeResponse) {
      // Update subscription status to active
      this.db.prepare(`
        UPDATE provider_webhook_subscriptions SET
          status = 'active',
          updated_at = ?
        WHERE connection_id = ?
      `).run(new Date().toISOString(), connectionId);

      return {
        statusCode: 200,
        responseBody: validation.challengeResponse
      };
    }

    // 5. Handle POST event signals: ingest into monitoring pipeline with deduplication
    const signals = validation.signals || [];
    let ingestedCount = 0;
    let duplicateCount = 0;

    // Get linked subjects for this connection
    const linkedSubjects = this.oauthService.getLinkedSubjects(connectionId);

    for (const sig of signals) {
      // For each linked subject, ingest signal
      for (const subjectId of linkedSubjects) {
        try {
          const res = this.signalIngestionService.ingestSignal(
            connRow.organization_id,
            'system_webhook',
            {
              subject_id: subjectId,
              adapter_name: 'youtube_websub',
              source_type: 'webhook',
              observed_url: sig.external_url,
              platform: 'youtube',
              content_type: sig.content_type,
              observed_at: new Date(sig.published_at || Date.now()).toISOString(),
              raw_payload: sig.raw_metadata,
              provenance: {
                provider_type: 'youtube',
                connection_id: connectionId,
                channel_id: sig.channel_id,
                channel_title: sig.channel_title,
                delivery_method: 'websub_push'
              }
            }
          );

          if (res.isDuplicate) {
            duplicateCount++;
          } else {
            ingestedCount++;
          }
        } catch (err: any) {
          // Log and continue processing remaining signals
        }
      }
    }

    // Update webhook subscription telemetry
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_webhook_subscriptions SET
        last_event_at = ?,
        event_count = event_count + 1,
        updated_at = ?
      WHERE connection_id = ?
    `).run(now, now, connectionId);

    return {
      statusCode: 200,
      responseBody: {
        success: true,
        received_signals: signals.length,
        ingested_count: ingestedCount,
        duplicate_count: duplicateCount
      }
    };
  }

  /**
   * Registers or updates a WebSub subscription record for a connection
   */
  public registerSubscription(
    connectionId: string,
    topicUrl: string,
    hubUrl: string = 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: number = 86400
  ): ProviderWebhookSubscription {
    const secret = this.getWebhookSecret(connectionId);
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const existing = this.db.prepare(`
      SELECT * FROM provider_webhook_subscriptions WHERE connection_id = ?
    `).get(connectionId) as any;

    if (existing) {
      this.db.prepare(`
        UPDATE provider_webhook_subscriptions SET
          topic_url = ?, hub_url = ?, secret_hash = ?, lease_seconds = ?,
          expires_at = ?, updated_at = ?
        WHERE connection_id = ?
      `).run(topicUrl, hubUrl, secretHash, leaseSeconds, expiresAt, now, connectionId);
    } else {
      const id = `pws_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      this.db.prepare(`
        INSERT INTO provider_webhook_subscriptions (
          id, connection_id, topic_url, hub_url, secret_hash, status,
          lease_seconds, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(id, connectionId, topicUrl, hubUrl, secretHash, leaseSeconds, expiresAt, now, now);
    }

    const row = this.db.prepare(`
      SELECT * FROM provider_webhook_subscriptions WHERE connection_id = ?
    `).get(connectionId) as any;

    return {
      id: row.id,
      connection_id: row.connection_id,
      topic_url: row.topic_url,
      hub_url: row.hub_url,
      secret_hash: row.secret_hash,
      status: row.status,
      lease_seconds: row.lease_seconds,
      expires_at: row.expires_at,
      last_event_at: row.last_event_at,
      event_count: row.event_count || 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Retrieves subscription for a connection
   */
  public getSubscription(connectionId: string): ProviderWebhookSubscription | null {
    const row = this.db.prepare(`
      SELECT * FROM provider_webhook_subscriptions WHERE connection_id = ?
    `).get(connectionId) as any;
    if (!row) return null;

    return {
      id: row.id,
      connection_id: row.connection_id,
      topic_url: row.topic_url,
      hub_url: row.hub_url,
      secret_hash: row.secret_hash,
      status: row.status,
      lease_seconds: row.lease_seconds,
      expires_at: row.expires_at,
      last_event_at: row.last_event_at,
      event_count: row.event_count || 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
