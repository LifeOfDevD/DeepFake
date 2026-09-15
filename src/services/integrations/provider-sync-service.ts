import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import { OAuthService } from './oauth-service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { YouTubeReadOnlyAdapter } from './youtube-adapter.js';
import { SignalIngestionService } from '../monitoring/signal-ingestion-service.js';
import { ProviderCursor } from '../../domain/types.js';

export interface SyncConnectionResult {
  connectionId: string;
  success: boolean;
  status: 'synced' | 'skipped_circuit_open' | 'skipped_not_canary' | 'skipped_paused' | 'error';
  ingestedSignals: number;
  duplicateSignals: number;
  error?: string;
}

export class ProviderSyncService {
  private db: Database.Database;
  private oauthService: OAuthService;
  private circuitBreaker: CircuitBreaker;
  private adapter: YouTubeReadOnlyAdapter;
  private signalIngestionService: SignalIngestionService;

  // In-memory emergency kill switch
  private static globalKillSwitchActive: boolean = false;

  constructor(db?: Database.Database, adapter?: YouTubeReadOnlyAdapter) {
    this.db = db || getDatabase();
    this.oauthService = new OAuthService(this.db);
    this.circuitBreaker = new CircuitBreaker(this.db);
    this.adapter = adapter || new YouTubeReadOnlyAdapter({ isMockMode: true });
    this.signalIngestionService = new SignalIngestionService(this.db);
  }

  public static setGlobalKillSwitch(active: boolean): void {
    this.globalKillSwitchActive = active;
  }

  public static isGlobalKillSwitchActive(): boolean {
    return this.globalKillSwitchActive;
  }

  /**
   * Performs an incremental sync of a specific connection
   */
  public async syncConnection(
    organizationId: string,
    connectionId: string,
    actorUserId: string = 'system_sync'
  ): Promise<SyncConnectionResult> {
    // 1. Global kill-switch check
    if (ProviderSyncService.isGlobalKillSwitchActive()) {
      return {
        connectionId,
        success: false,
        status: 'skipped_paused',
        ingestedSignals: 0,
        duplicateSignals: 0,
        error: 'KILL_SWITCH_ACTIVE: Provider integrations are globally disabled by administrator kill-switch'
      };
    }

    // 2. Fetch connection
    const conn = this.oauthService.getConnection(organizationId, connectionId);
    if (!conn) {
      return {
        connectionId,
        success: false,
        status: 'error',
        ingestedSignals: 0,
        duplicateSignals: 0,
        error: 'CONNECTION_NOT_FOUND'
      };
    }

    if (conn.status === 'disconnected' || conn.is_paused === 1) {
      return {
        connectionId,
        success: true,
        status: 'skipped_paused',
        ingestedSignals: 0,
        duplicateSignals: 0
      };
    }

    // 3. Canary organization check
    const ent = this.db.prepare(`
      SELECT is_integration_canary_enabled FROM pilot_entitlements WHERE organization_id = ?
    `).get(organizationId) as { is_integration_canary_enabled?: number } | undefined;

    if (!ent?.is_integration_canary_enabled) {
      return {
        connectionId,
        success: false,
        status: 'skipped_not_canary',
        ingestedSignals: 0,
        duplicateSignals: 0,
        error: 'NOT_CANARY_ORGANIZATION: Organization is not authorized for integration canary pilot'
      };
    }

    // 4. Circuit breaker readiness
    const readiness = this.circuitBreaker.canExecute(connectionId);
    if (!readiness.canExecute) {
      return {
        connectionId,
        success: false,
        status: 'skipped_circuit_open',
        ingestedSignals: 0,
        duplicateSignals: 0,
        error: readiness.reason
      };
    }

    // 5. Decrypt credentials & refresh if expired
    let credentials = this.oauthService.getInternalConnectionWithCredentials(connectionId);
    if (!credentials) {
      return {
        connectionId,
        success: false,
        status: 'error',
        ingestedSignals: 0,
        duplicateSignals: 0,
        error: 'MISSING_CREDENTIALS'
      };
    }

    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() <= Date.now() + 60000) {
      try {
        await this.oauthService.refreshConnectionToken(connectionId, this.adapter);
        credentials = this.oauthService.getInternalConnectionWithCredentials(connectionId)!;
      } catch (err: any) {
        return {
          connectionId,
          success: false,
          status: 'error',
          ingestedSignals: 0,
          duplicateSignals: 0,
          error: `TOKEN_REFRESH_FAILED: ${err.message}`
        };
      }
    }

    // 6. Execute incremental sync inside circuit breaker
    let ingestedCount = 0;
    let duplicateCount = 0;

    try {
      await this.circuitBreaker.execute(connectionId, async () => {
        // Fetch cursor for uploads
        const cursorRow = this.db.prepare(`
          SELECT * FROM provider_sync_cursors WHERE connection_id = ? AND feed_type = 'channel_uploads'
        `).get(connectionId) as any;

        const cursor: ProviderCursor | null = cursorRow
          ? {
              id: cursorRow.id,
              connection_id: cursorRow.connection_id,
              feed_type: 'channel_uploads',
              last_cursor: cursorRow.last_cursor,
              last_synced_at: cursorRow.last_synced_at,
              item_count: cursorRow.item_count,
              updated_at: cursorRow.updated_at
            }
          : null;

        // Fetch uploads
        const uploadsResult = await this.adapter.fetchRecentItems(
          conn,
          credentials.decryptedAccessToken,
          cursor
        );

        // Ingest signals for linked subjects
        const linkedSubjects = this.oauthService.getLinkedSubjects(connectionId);

        for (const sig of uploadsResult.signals) {
          for (const subjectId of linkedSubjects) {
            try {
              const res = this.signalIngestionService.ingestSignal(
                organizationId,
                actorUserId,
                {
                  subject_id: subjectId,
                  adapter_name: 'youtube_read_only',
                  source_type: 'external_provider',
                  observed_url: sig.external_url,
                  platform: 'youtube',
                  content_type: sig.content_type,
                  observed_at: sig.published_at,
                  raw_payload: sig.raw_metadata,
                  provenance: {
                    provider_type: 'youtube',
                    connection_id: connectionId,
                    channel_id: sig.channel_id,
                    channel_title: sig.channel_title,
                    feed_type: 'channel_uploads'
                  }
                }
              );

              if (res.isDuplicate) {
                duplicateCount++;
              } else {
                ingestedCount++;
              }
            } catch (err) {
              // Ignore duplicate or individual ingestion errors
            }
          }
        }

        // Update cursor
        const now = new Date().toISOString();
        if (cursorRow) {
          this.db.prepare(`
            UPDATE provider_sync_cursors SET
              last_cursor = ?,
              last_synced_at = ?,
              item_count = item_count + ?,
              updated_at = ?
            WHERE id = ?
          `).run(uploadsResult.nextCursor, now, uploadsResult.signals.length, now, cursorRow.id);
        } else {
          const curId = `cur_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
          this.db.prepare(`
            INSERT INTO provider_sync_cursors (
              id, connection_id, feed_type, last_cursor, last_synced_at, item_count, updated_at
            ) VALUES (?, ?, 'channel_uploads', ?, ?, ?, ?)
          `).run(curId, connectionId, uploadsResult.nextCursor, now, uploadsResult.signals.length, now);
        }

        // Update last_successful_sync_at on connection
        this.db.prepare(`
          UPDATE provider_connections SET
            last_successful_sync_at = ?,
            last_error = NULL,
            updated_at = ?
          WHERE id = ?
        `).run(now, now, connectionId);
      });

      return {
        connectionId,
        success: true,
        status: 'synced',
        ingestedSignals: ingestedCount,
        duplicateSignals: duplicateCount
      };
    } catch (err: any) {
      return {
        connectionId,
        success: false,
        status: 'error',
        ingestedSignals: ingestedCount,
        duplicateSignals: duplicateCount,
        error: err.message
      };
    }
  }

  /**
   * Syncs all active canary-enabled connections across all organizations (for background worker loop)
   */
  public async syncAllActiveConnections(): Promise<{
    totalConnections: number;
    synced: number;
    skipped: number;
    errors: number;
    totalIngested: number;
  }> {
    if (ProviderSyncService.isGlobalKillSwitchActive()) {
      return { totalConnections: 0, synced: 0, skipped: 0, errors: 0, totalIngested: 0 };
    }

    const connections = this.db.prepare(`
      SELECT c.* FROM provider_connections c
      JOIN pilot_entitlements e ON c.organization_id = e.organization_id
      WHERE c.status = 'connected' AND c.is_paused = 0 AND e.is_integration_canary_enabled = 1
    `).all() as any[];

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    let totalIngested = 0;

    for (const conn of connections) {
      const res = await this.syncConnection(conn.organization_id, conn.id, 'provider_sync_worker');
      if (res.status === 'synced') {
        synced++;
        totalIngested += res.ingestedSignals;
      } else if (res.status.startsWith('skipped')) {
        skipped++;
      } else {
        errors++;
      }
    }

    return {
      totalConnections: connections.length,
      synced,
      skipped,
      errors,
      totalIngested
    };
  }
}
