-- ============================================================================
-- MIGRATION 0002: EVIDENCE LOCKER & CHAIN OF CUSTODY (PHASE 2)
-- ============================================================================

-- Evidence Items (Preserved digital assets & chain of custody)
CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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

-- Evidence Access Events (Granular chain-of-custody audit trail)
CREATE TABLE IF NOT EXISTS evidence_access_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

-- Evidence Retention Holds (Legal holds that block automatic/manual purging)
CREATE TABLE IF NOT EXISTS evidence_retention_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  released_at TEXT
);

-- Tenant-scoped Indexes
CREATE INDEX IF NOT EXISTS idx_evidence_org_case ON evidence_items(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_org_status ON evidence_items(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_sha256 ON evidence_items(organization_id, sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_access_evidence ON evidence_access_events(evidence_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_access_org ON evidence_access_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_holds_evidence ON evidence_retention_holds(evidence_id);
