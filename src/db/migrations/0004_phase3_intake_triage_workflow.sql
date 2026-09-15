-- ============================================================================
-- MIGRATION 0004: PHASE 3 INTAKE, TRIAGE, STATUTORY CLOCKS & WORKFLOW
-- ============================================================================

-- 1. Extend Cases with Structured Incident Intake Fields
ALTER TABLE cases ADD COLUMN target_entity_type TEXT NOT NULL DEFAULT 'individual_professional';
ALTER TABLE cases ADD COLUMN affected_jurisdiction TEXT NOT NULL DEFAULT 'IN-National';
ALTER TABLE cases ADD COLUMN urgency TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE cases ADD COLUMN suspected_synthetic_media_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cases ADD COLUMN impersonation_method TEXT NOT NULL DEFAULT 'profile_cloning';
ALTER TABLE cases ADD COLUMN harm_type TEXT NOT NULL DEFAULT 'reputational';
ALTER TABLE cases ADD COLUMN involves_intimate_imagery INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN has_court_or_government_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN court_or_government_order_details TEXT;
ALTER TABLE cases ADD COLUMN discovered_at TEXT;
ALTER TABLE cases ADD COLUMN reported_by_name TEXT;
ALTER TABLE cases ADD COLUMN factual_basis TEXT;
ALTER TABLE cases ADD COLUMN operator_notes TEXT;
ALTER TABLE cases ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE cases ADD COLUMN selected_legal_grounds TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cases ADD COLUMN declaration_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN declared_at TEXT;
ALTER TABLE cases ADD COLUMN normalized_contested_url TEXT;

-- 2. Case Triage Records Table
CREATE TABLE IF NOT EXISTS case_triage_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL,
  confidence TEXT NOT NULL, -- 'high', 'medium', 'low'
  triggered_rules TEXT NOT NULL DEFAULT '[]',
  actor_or_component TEXT NOT NULL,
  requires_human_review INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Statutory Clocks Table
CREATE TABLE IF NOT EXISTS statutory_clocks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  incident_discovered_at TEXT NOT NULL,
  complaint_created_at TEXT NOT NULL,
  acknowledgement_deadline TEXT NOT NULL,
  submission_deadline TEXT NOT NULL,
  escalation_deadline TEXT NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'running', -- 'not_started', 'running', 'paused', 'due_soon', 'overdue', 'completed', 'cancelled'
  paused_reason TEXT,
  operational_basis TEXT NOT NULL,
  source_note TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  court_order_evidence TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Case Readiness Evaluations Table
CREATE TABLE IF NOT EXISTS case_readiness_evaluations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  is_ready INTEGER NOT NULL,
  passed_checks TEXT NOT NULL DEFAULT '[]',
  missing_requirements TEXT NOT NULL DEFAULT '[]',
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Submission Packets Table
CREATE TABLE IF NOT EXISTS submission_packets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  packet_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'dry_run_generated', -- 'dry_run_generated', 'approved', 'simulated'
  packet_hash TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  packet_markdown TEXT NOT NULL,
  evidence_manifest_json TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  approved_by TEXT,
  simulated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Case Approval Records Table
CREATE TABLE IF NOT EXISTS case_approval_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  approval_type TEXT NOT NULL, -- 'triage', 'legal_review', 'readiness', 'submission_simulation'
  action TEXT NOT NULL, -- 'approved', 'rejected', 'blocked'
  decided_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision_reason TEXT NOT NULL,
  from_approval_state TEXT NOT NULL,
  to_approval_state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 7. Internal Workflow Task Queue Table
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL, -- 'missing_evidence', 'legal_review_required', 'deadline_due_soon', 'overdue_escalation', 'duplicate_incident_review', 'packet_approval_required', 'retention_or_evidence_issue'
  priority TEXT NOT NULL DEFAULT 'p2', -- 'p1', 'p2', 'p3', 'p4'
  due_at TEXT,
  assigned_role TEXT NOT NULL,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
  creation_reason TEXT NOT NULL,
  completion_reason TEXT,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 8. Duplicate Case Links Table
CREATE TABLE IF NOT EXISTS duplicate_case_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  matched_case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  match_reason TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'confirmed_duplicate', 'dismissed'
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Indexes for performant lookups and tenant queries
CREATE INDEX IF NOT EXISTS idx_cases_approval_status ON cases(organization_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_cases_normalized_url ON cases(organization_id, normalized_contested_url);
CREATE INDEX IF NOT EXISTS idx_triage_case ON case_triage_records(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clock_case ON statutory_clocks(case_id);
CREATE INDEX IF NOT EXISTS idx_clock_status ON statutory_clocks(organization_id, current_status);
CREATE INDEX IF NOT EXISTS idx_readiness_case ON case_readiness_evaluations(case_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_packets_case ON submission_packets(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_case ON case_approval_records(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON workflow_tasks(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_case ON workflow_tasks(case_id, status);
CREATE INDEX IF NOT EXISTS idx_duplicates_source ON duplicate_case_links(source_case_id);
