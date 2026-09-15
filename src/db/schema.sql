-- ============================================================================
-- DIGITAL IMPERSONATION RESPONSE DESK SCHEMA
-- Engine: SQLite 3 with WAL Mode and Foreign Key Enforcement
-- ============================================================================

-- Organizations (Tenant isolation boundary)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  industry TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'IN-DL',
  primary_contact_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Users (Platform accounts)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  system_role TEXT NOT NULL DEFAULT 'user', -- 'system_admin' or 'user'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Memberships (Organization RBAC binding)
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'read_only_stakeholder'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, organization_id)
);

-- Cases (Incident response tickets)
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_number TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new',
  target_entity TEXT NOT NULL,
  contested_url TEXT NOT NULL,
  hosting_platform TEXT NOT NULL,
  reported_by_email TEXT NOT NULL,
  assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  requires_legal_review INTEGER NOT NULL DEFAULT 0,
  statutory_basis TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(organization_id, case_number)
);

-- Case Status History (Immutable record of transitions)
CREATE TABLE IF NOT EXISTS case_status_history (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Case Notes (Internal operator and team discussions)
CREATE TABLE IF NOT EXISTS case_notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_internal_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Audit Events (Append-only security and operational ledger)
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details TEXT NOT NULL, -- JSON string
  ip_address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Indexes for performance and tenant isolation
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_cases_org_status ON cases(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_case_status_history_case ON case_status_history(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events(organization_id, created_at DESC);

-- ============================================================================
-- PHASE 2: EVIDENCE LOCKER & CHAIN OF CUSTODY
-- ============================================================================

-- Evidence Items
CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  safe_display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  detected_mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
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

-- Evidence Access Events
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

-- Evidence Retention Holds
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

-- Indexes for Phase 2 Evidence
CREATE INDEX IF NOT EXISTS idx_evidence_org_case ON evidence_items(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_org_status ON evidence_items(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_sha256 ON evidence_items(organization_id, sha256);
CREATE INDEX IF NOT EXISTS idx_evidence_access_evidence ON evidence_access_events(evidence_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_access_org ON evidence_access_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_holds_evidence ON evidence_retention_holds(evidence_id);

