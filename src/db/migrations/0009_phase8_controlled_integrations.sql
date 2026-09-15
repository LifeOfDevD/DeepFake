-- ============================================================================
-- MIGRATION 0009: PHASE 8 CONTROLLED READ-ONLY INTEGRATIONS
-- ============================================================================

-- 1. Extend Pilot Entitlements with Integration Canary Flags & Limits
ALTER TABLE pilot_entitlements ADD COLUMN is_integration_canary_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pilot_entitlements ADD COLUMN max_provider_connections INTEGER NOT NULL DEFAULT 2;

-- 2. Provider Connections Table
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL, -- 'youtube'
  status TEXT NOT NULL, -- 'pending_auth', 'connected', 'degraded', 'disconnected', 'revoked', 'error'
  account_id TEXT, -- e.g. YouTube Channel ID
  account_name TEXT, -- e.g. Channel Title
  account_email TEXT,
  scopes TEXT NOT NULL DEFAULT '[]', -- JSON array of granted scopes
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TEXT,
  last_token_refresh_at TEXT,
  last_successful_sync_at TEXT,
  last_error TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  is_canary INTEGER NOT NULL DEFAULT 0,
  is_paused INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_conn_org ON provider_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_provider_conn_status ON provider_connections(status);
CREATE INDEX IF NOT EXISTS idx_provider_conn_type ON provider_connections(provider_type);

-- 3. Provider Connection Monitored Subjects Mapping
CREATE TABLE IF NOT EXISTS provider_connection_subjects (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES monitored_subjects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(connection_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_conn_subj_conn ON provider_connection_subjects(connection_id);
CREATE INDEX IF NOT EXISTS idx_conn_subj_subject ON provider_connection_subjects(subject_id);

-- 4. Provider Incremental Sync Cursors
CREATE TABLE IF NOT EXISTS provider_sync_cursors (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  feed_type TEXT NOT NULL, -- 'channel_uploads', 'search_candidates'
  last_cursor TEXT, -- Page token or ISO timestamp
  last_synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  item_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(connection_id, feed_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_cursor_conn ON provider_sync_cursors(connection_id);

-- 5. Provider Circuit Breaker States
CREATE TABLE IF NOT EXISTS provider_circuit_states (
  connection_id TEXT PRIMARY KEY REFERENCES provider_connections(id) ON DELETE CASCADE,
  circuit_state TEXT NOT NULL DEFAULT 'closed', -- 'closed', 'open', 'half_open'
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_failure_reason TEXT,
  opened_at TEXT,
  cooldown_until TEXT,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  total_retries INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Provider Webhook Subscriptions (WebSub / PubSubHubbub)
CREATE TABLE IF NOT EXISTS provider_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
  topic_url TEXT NOT NULL,
  hub_url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'expired', 'failed'
  lease_seconds INTEGER NOT NULL DEFAULT 86400,
  expires_at TEXT,
  last_event_at TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_sub_conn ON provider_webhook_subscriptions(connection_id);

-- 7. OAuth State Nonces (Single-use CSRF mitigation)
CREATE TABLE IF NOT EXISTS oauth_state_nonces (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL,
  state_token TEXT NOT NULL UNIQUE,
  subject_id TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_nonce_token ON oauth_state_nonces(state_token);
CREATE INDEX IF NOT EXISTS idx_oauth_nonce_org ON oauth_state_nonces(organization_id);
