-- ============================================================================
-- MIGRATION 0006: PHASE 5 PILOT SAAS, ONBOARDING, USAGE METERING & NOTIFICATIONS
-- ============================================================================

-- 1. Extend organizations with onboarding, timezone, and pilot status
ALTER TABLE organizations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN onboarding_checklist TEXT NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN pilot_settings TEXT NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN deactivated_at TEXT;
ALTER TABLE organizations ADD COLUMN deactivated_by TEXT;
ALTER TABLE organizations ADD COLUMN deactivation_reason TEXT;

-- 2. Extend users with suspension fields
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE users ADD COLUMN suspended_by TEXT;
ALTER TABLE users ADD COLUMN suspension_reason TEXT;

-- 3. Secure User Invitations Table
CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Pilot Entitlements & Feature Flags Table
CREATE TABLE IF NOT EXISTS pilot_entitlements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_tier TEXT NOT NULL DEFAULT 'pilot',
  pilot_start_date TEXT NOT NULL,
  pilot_end_date TEXT NOT NULL,
  enabled_features TEXT NOT NULL DEFAULT '[]',
  max_users INTEGER NOT NULL DEFAULT 10,
  max_active_cases INTEGER NOT NULL DEFAULT 25,
  max_monthly_evidence_uploads INTEGER NOT NULL DEFAULT 100,
  max_storage_bytes INTEGER NOT NULL DEFAULT 5368709120,
  max_simulated_submissions_per_month INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Raw Usage Metering Events Table
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  resource_id TEXT,
  actor_user_id TEXT,
  metadata TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Aggregated Daily Usage Table
CREATE TABLE IF NOT EXISTS usage_daily_aggregates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL,
  total_quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(organization_id, date, event_type)
);

-- 7. Usage Adjustments (Admin Corrections) Table
CREATE TABLE IF NOT EXISTS usage_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  quantity_delta REAL NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 8. Notification Outbox Table
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  recipient_role TEXT,
  recipient_email TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  delivery_channel TEXT NOT NULL DEFAULT 'in_app',
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 9. In-App Notifications Table
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_outbox_id TEXT REFERENCES notification_outbox(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 10. Operational Worker Heartbeats Table
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'stopped',
  last_heartbeat_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_run_duration_ms INTEGER,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata TEXT
);

-- Indexes for performant lookup & tenant isolation
CREATE INDEX IF NOT EXISTS idx_invitations_org ON organization_invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_usage_org_recorded ON usage_events(organization_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_aggregates_org_date ON usage_daily_aggregates(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_outbox_org_status ON notification_outbox(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_in_app_user_unread ON in_app_notifications(user_id, is_read);
