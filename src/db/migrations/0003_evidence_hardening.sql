-- ============================================================================
-- MIGRATION 0003: EVIDENCE LOCKER HARDENING & TWO-PERSON DELETION (PHASE 2)
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- 1. Hardened Evidence Items with ON DELETE RESTRICT for Chain of Custody
CREATE TABLE IF NOT EXISTS evidence_items_hardened (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL, -- 'image', 'video', 'audio', 'pdf', 'text', 'screenshot', 'source_url', 'note'
  original_filename TEXT NOT NULL,
  safe_display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  detected_mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'available', 'quarantined', 'rejected', 'deletion_requested', 'deleted', 'retention_expired'
  sensitivity TEXT NOT NULL DEFAULT 'normal', -- 'normal', 'sensitive', 'restricted', 'prohibited'
  source_url TEXT,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  retention_until TEXT NOT NULL,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deletion_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO evidence_items_hardened SELECT * FROM evidence_items;
DROP TABLE IF EXISTS evidence_items;
ALTER TABLE evidence_items_hardened RENAME TO evidence_items;

-- 2. Hardened Access Events with ON DELETE RESTRICT
CREATE TABLE IF NOT EXISTS evidence_access_events_hardened (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO evidence_access_events_hardened SELECT * FROM evidence_access_events;
DROP TABLE IF EXISTS evidence_access_events;
ALTER TABLE evidence_access_events_hardened RENAME TO evidence_access_events;

-- 3. Hardened Retention Holds with ON DELETE RESTRICT
CREATE TABLE IF NOT EXISTS evidence_retention_holds_hardened (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  released_at TEXT
);

INSERT OR IGNORE INTO evidence_retention_holds_hardened SELECT * FROM evidence_retention_holds;
DROP TABLE IF EXISTS evidence_retention_holds;
ALTER TABLE evidence_retention_holds_hardened RENAME TO evidence_retention_holds;

-- 4. Two-Person Deletion Approval Ledger
CREATE TABLE IF NOT EXISTS evidence_deletion_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_reason TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  review_reason TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

PRAGMA foreign_keys = ON;

-- Recreate all Indexes
CREATE INDEX IF NOT EXISTS idx_evidence_org_case ON evidence_items(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_org_status ON evidence_items(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_sha256 ON evidence_items(organization_id, sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_access_evidence ON evidence_access_events(evidence_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_access_org ON evidence_access_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_holds_evidence ON evidence_retention_holds(evidence_id);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending ON evidence_deletion_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_evidence ON evidence_deletion_requests(evidence_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_case ON evidence_deletion_requests(case_id);
