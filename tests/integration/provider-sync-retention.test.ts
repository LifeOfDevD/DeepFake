import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { ProviderSyncService } from '../../src/services/integrations/provider-sync-service.js';
import { YouTubeReadOnlyAdapter } from '../../src/services/integrations/youtube-adapter.js';
import { WorkerManager } from '../../src/workers/worker-manager.js';
import { TokenEncryption } from '../../src/services/integrations/token-encryption.js';

describe('Integration: Provider Sync, Retention & Canary Isolation', () => {
  let db: Database.Database;
  let syncService: ProviderSyncService;
  let workerManager: WorkerManager;
  const adapter = new YouTubeReadOnlyAdapter({ isMockMode: true });

  const orgCanary = 'org_sync_canary_01';
  const orgRegular = 'org_sync_regular_02';
  const userCanary = 'usr_sync_canary_01';
  const subjectCanary = 'sub_sync_canary_01';
  const connCanary = 'conn_sync_canary_01';
  const connRegular = 'conn_sync_regular_02';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);

    // Reset kill-switch
    ProviderSyncService.setGlobalKillSwitch(false);

    // Seed organizations and users
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Canary Org', 'canary-org', 'healthcare', 'IN-DL', 'canary@example.in'),
             (?, 'Regular Org', 'regular-org', 'consumer_goods', 'IN-MH', 'regular@example.in')
    `).run(orgCanary, orgRegular);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'user.canary@example.in', 'User Canary', 'pw1')
    `).run(userCanary);

    // Canary entitlement: is_integration_canary_enabled = 1 vs 0
    db.prepare(`
      INSERT INTO pilot_entitlements (id, organization_id, pilot_start_date, pilot_end_date, is_integration_canary_enabled, max_provider_connections)
      VALUES ('ent_c1', ?, '2026-01-01', '2026-12-31', 1, 5),
             ('ent_r1', ?, '2026-01-01', '2026-12-31', 0, 1)
    `).run(orgCanary, orgRegular);

    // Monitored subject for canary org
    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, created_by_user_id, monitoring_status
      ) VALUES (
        ?, ?, 'doctor', 'Dr. Ananya Rao', 'representation_agreement', 'REF-SYNC-01', ?, 'active'
      )
    `).run(subjectCanary, orgCanary, userCanary);

    // Encrypted mock tokens
    const encAccess = TokenEncryption.encrypt('ya29.mock_access_token');
    const encRefresh = TokenEncryption.encrypt('1//mock_refresh_token');

    // Create canary connection
    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        scopes, encrypted_access_token, encrypted_refresh_token, is_canary, is_paused,
        created_by_user_id
      ) VALUES (
        ?, ?, 'youtube', 'connected', 'UC_canary_channel_01', 'Canary Channel',
        '["https://www.googleapis.com/auth/youtube.readonly"]', ?, ?, 1, 0, ?
      )
    `).run(connCanary, orgCanary, encAccess, encRefresh, userCanary);

    db.prepare(`
      INSERT INTO provider_connection_subjects (id, connection_id, subject_id)
      VALUES ('pcs_c1', ?, ?)
    `).run(connCanary, subjectCanary);

    db.prepare(`
      INSERT INTO provider_circuit_states (connection_id, circuit_state)
      VALUES (?, 'closed')
    `).run(connCanary);

    // Create regular connection
    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        scopes, encrypted_access_token, encrypted_refresh_token, is_canary, is_paused,
        created_by_user_id
      ) VALUES (
        ?, ?, 'youtube', 'connected', 'UC_regular_channel_02', 'Regular Channel',
        '["https://www.googleapis.com/auth/youtube.readonly"]', ?, ?, 0, 0, ?
      )
    `).run(connRegular, orgRegular, encAccess, encRefresh, userCanary);

    db.prepare(`
      INSERT INTO provider_circuit_states (connection_id, circuit_state)
      VALUES (?, 'closed')
    `).run(connRegular);

    syncService = new ProviderSyncService(db, adapter);
    workerManager = new WorkerManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it('enforces tenant canary gate: rejects syncing connections belonging to non-canary organizations', async () => {
    const res = await syncService.syncConnection(orgRegular, connRegular);

    expect(res.success).toBe(false);
    expect(res.status).toBe('skipped_not_canary');
    expect(res.error).toContain('NOT_CANARY_ORGANIZATION');
  });

  it('successfully syncs canary connection, updates cursor, and populates candidate reviews', async () => {
    const res = await syncService.syncConnection(orgCanary, connCanary);

    expect(res.success).toBe(true);
    expect(res.status).toBe('synced');
    expect(res.ingestedSignals).toBeGreaterThan(0);

    // Verify signal is in monitoring_signals with source_type = external_provider
    const signals = db.prepare(`
      SELECT * FROM monitoring_signals WHERE organization_id = ? AND source_type = 'external_provider'
    `).all(orgCanary) as any[];

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].adapter_name).toBe('youtube_read_only');
    expect(signals[0].platform).toBe('youtube');

    // Verify candidate review queue has pending entry
    const reviews = db.prepare(`
      SELECT * FROM candidate_reviews WHERE organization_id = ?
    `).all(orgCanary) as any[];

    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].status).toBe('pending');

    // Verify cursor updated
    const cursor = db.prepare(`
      SELECT * FROM provider_sync_cursors WHERE connection_id = ? AND feed_type = 'channel_uploads'
    `).get(connCanary) as any;

    expect(cursor).toBeDefined();
    expect(cursor.last_cursor).toBe('mock_next_page_token_123');

    // Verify last_successful_sync_at updated
    const conn = db.prepare('SELECT last_successful_sync_at FROM provider_connections WHERE id = ?').get(connCanary) as any;
    expect(conn.last_successful_sync_at).toBeDefined();
  });

  it('skips sync when global emergency kill switch is activated', async () => {
    ProviderSyncService.setGlobalKillSwitch(true);

    const res = await syncService.syncConnection(orgCanary, connCanary);
    expect(res.success).toBe(false);
    expect(res.status).toBe('skipped_paused');
    expect(res.error).toContain('KILL_SWITCH_ACTIVE');
  });

  it('skips sync when circuit breaker is open', async () => {
    // Force circuit open
    db.prepare(`
      UPDATE provider_circuit_states SET
        circuit_state = 'open',
        cooldown_until = '2099-01-01T00:00:00Z'
      WHERE connection_id = ?
    `).run(connCanary);

    const res = await syncService.syncConnection(orgCanary, connCanary);
    expect(res.success).toBe(false);
    expect(res.status).toBe('skipped_circuit_open');
    expect(res.error).toContain('CIRCUIT_OPEN');
  });

  it('executes retention worker: purges 30-day unreferenced provider signals while preserving legal-hold signals', async () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

    // Insert 1 old unreferenced provider signal (should be purged)
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type, observed_url,
        normalized_url, platform, observed_at, content_type, content_hash, metadata_hash,
        provenance, idempotency_key, processing_status, created_at, updated_at
      ) VALUES (
        'sig_old_unref', ?, ?, 'youtube_read_only', 'external_provider', 'https://www.youtube.com/watch?v=old_unref',
        'https://www.youtube.com/watch?v=old_unref', 'youtube', ?, 'video', 'h1', 'mh1',
        '{}', 'idemp_1', 'pending', ?, ?
      )
    `).run(orgCanary, subjectCanary, oldDate, oldDate, oldDate);

    // Insert 1 old referenced provider signal linked to a case (must be PRESERVED)
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type, observed_url,
        normalized_url, platform, observed_at, content_type, content_hash, metadata_hash,
        provenance, idempotency_key, processing_status, created_at, updated_at
      ) VALUES (
        'sig_old_linked', ?, ?, 'youtube_read_only', 'external_provider', 'https://www.youtube.com/watch?v=old_linked',
        'https://www.youtube.com/watch?v=old_linked', 'youtube', ?, 'video', 'h2', 'mh2',
        '{}', 'idemp_2', 'reviewed', ?, ?
      )
    `).run(orgCanary, subjectCanary, oldDate, oldDate, oldDate);

    // Create a case and link it
    db.prepare(`
      INSERT INTO cases (
        id, case_number, organization_id, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email
      ) VALUES (
        'case_ret_01', 'CASE-RET-01', ?, 'Test Case', 'impersonation', 'medium', 'new',
        'Dr. Ananya Rao', 'https://example.com', 'youtube', 'test@example.in'
      )
    `).run(orgCanary);

    db.prepare(`
      INSERT INTO signal_case_links (id, signal_id, case_id, link_type, linked_by_user_id)
      VALUES ('scl_ret_01', 'sig_old_linked', 'case_ret_01', 'evidence', ?)
    `).run(userCanary);

    // Insert 1 recent unreferenced provider signal (must be PRESERVED)
    db.prepare(`
      INSERT INTO monitoring_signals (
        id, organization_id, subject_id, adapter_name, source_type, observed_url,
        normalized_url, platform, observed_at, content_type, content_hash, metadata_hash,
        provenance, idempotency_key, processing_status, created_at, updated_at
      ) VALUES (
        'sig_recent_unref', ?, ?, 'youtube_read_only', 'external_provider', 'https://www.youtube.com/watch?v=recent_unref',
        'https://www.youtube.com/watch?v=recent_unref', 'youtube', ?, 'video', 'h3', 'mh3',
        '{}', 'idemp_3', 'pending', ?, ?
      )
    `).run(orgCanary, subjectCanary, recentDate, recentDate, recentDate);

    // Run retention worker
    const retentionResult = await workerManager.runRetentionWorker();
    expect(retentionResult.purgedProviderSignals).toBe(1);

    // Verify only 'sig_old_unref' was deleted
    expect(db.prepare("SELECT id FROM monitoring_signals WHERE id = 'sig_old_unref'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM monitoring_signals WHERE id = 'sig_old_linked'").get()).toBeDefined();
    expect(db.prepare("SELECT id FROM monitoring_signals WHERE id = 'sig_recent_unref'").get()).toBeDefined();
  });
});
