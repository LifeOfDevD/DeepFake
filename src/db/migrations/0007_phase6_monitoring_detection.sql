-- ============================================================================
-- MIGRATION 0007: PHASE 6 AUTOMATED MONITORING, DETECTION INTAKE & CANDIDATE CORRELATION
-- ============================================================================

-- 1. Extend Pilot Entitlements with Monitoring Quotas
ALTER TABLE pilot_entitlements ADD COLUMN max_monitored_subjects INTEGER NOT NULL DEFAULT 5;
ALTER TABLE pilot_entitlements ADD COLUMN max_monthly_monitoring_signals INTEGER NOT NULL DEFAULT 500;

-- 2. Monitored Subjects Table
CREATE TABLE IF NOT EXISTS monitored_subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subject_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  handles TEXT NOT NULL DEFAULT '[]',
  official_domains TEXT NOT NULL DEFAULT '[]',
  official_social_urls TEXT NOT NULL DEFAULT '[]',
  reference_images_metadata TEXT NOT NULL DEFAULT '[]',
  reference_audio_metadata TEXT NOT NULL DEFAULT '[]',
  voice_enrollment_status TEXT NOT NULL DEFAULT 'not_enrolled',
  face_enrollment_status TEXT NOT NULL DEFAULT 'not_enrolled',
  monitoring_status TEXT NOT NULL DEFAULT 'draft',
  authorization_basis TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'IN',
  sensitivity TEXT NOT NULL DEFAULT 'medium',
  retention_policy_days INTEGER NOT NULL DEFAULT 90,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Monitoring Policies Table
CREATE TABLE IF NOT EXISTS monitoring_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES monitored_subjects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  enabled_signal_types TEXT NOT NULL DEFAULT '[]',
  enabled_adapters TEXT NOT NULL DEFAULT '[]',
  scan_schedule TEXT NOT NULL DEFAULT 'hourly',
  max_monthly_candidate_volume INTEGER NOT NULL DEFAULT 100,
  alert_threshold REAL NOT NULL DEFAULT 0.7,
  auto_link_threshold REAL NOT NULL DEFAULT 0.85,
  human_review_threshold REAL NOT NULL DEFAULT 0.3,
  retention_days INTEGER NOT NULL DEFAULT 90,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Monitoring Signals Table (Durable Intake)
CREATE TABLE IF NOT EXISTS monitoring_signals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES monitored_subjects(id) ON DELETE RESTRICT,
  policy_id TEXT REFERENCES monitoring_policies(id) ON DELETE SET NULL,
  adapter_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  observed_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'profile',
  content_hash TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Candidate Correlations Table
CREATE TABLE IF NOT EXISTS candidate_correlations (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL UNIQUE REFERENCES monitoring_signals(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES monitored_subjects(id) ON DELETE RESTRICT,
  matched_rules TEXT NOT NULL DEFAULT '[]',
  confidence_category TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  risk_factors TEXT NOT NULL DEFAULT '[]',
  false_positive_indicators TEXT NOT NULL DEFAULT '[]',
  recommended_action TEXT NOT NULL DEFAULT 'queue_for_review',
  human_review_mandatory INTEGER NOT NULL DEFAULT 1,
  correlated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Candidate Risk Scores Table (Weighted Scoring Factor Breakdown)
CREATE TABLE IF NOT EXISTS candidate_risk_scores (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES monitoring_signals(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  score_version TEXT NOT NULL DEFAULT 'v1.0',
  factors TEXT NOT NULL DEFAULT '{}',
  threshold_applied REAL NOT NULL,
  disclaimer TEXT NOT NULL,
  ruleset_identifier TEXT NOT NULL DEFAULT 'default_ruleset_v1',
  calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 7. Candidate Reviews Table (Human Review Queue)
CREATE TABLE IF NOT EXISTS candidate_reviews (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL UNIQUE REFERENCES monitoring_signals(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  analyst_decision TEXT,
  decision_reason TEXT,
  false_positive_category TEXT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 8. Signal-Case Links Table
CREATE TABLE IF NOT EXISTS signal_case_links (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES monitoring_signals(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  link_type TEXT NOT NULL DEFAULT 'evidence',
  linked_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(signal_id, case_id)
);

-- 9. Monitoring Registered Adapters Metadata Table
CREATE TABLE IF NOT EXISTS monitoring_adapters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  adapter_type TEXT NOT NULL,
  description TEXT NOT NULL,
  config_schema TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  is_safe_read_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seed safe adapters metadata
INSERT OR IGNORE INTO monitoring_adapters (id, name, adapter_type, description, is_safe_read_only)
VALUES 
  ('adp_manual', 'manual_intake', 'manual', 'Manual analyst entry of candidate URLs and metadata', 1),
  ('adp_file_replay', 'file_replay', 'file_replay', 'Replay structured candidate signals from deterministic fixture files', 1),
  ('adp_webhook', 'inbound_webhook', 'webhook', 'Secure signed inbound webhook receiver for partner intelligence feeds', 1),
  ('adp_local_fixture', 'local_fixture', 'local_fixture', 'Deterministic local offline simulation signal generator', 1);

-- Indexes for performant lookup & tenant isolation
CREATE INDEX IF NOT EXISTS idx_subjects_org_status ON monitored_subjects(organization_id, monitoring_status);
CREATE INDEX IF NOT EXISTS idx_policies_org_subject ON monitoring_policies(organization_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_signals_org_status ON monitoring_signals(organization_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_signals_normalized_url ON monitoring_signals(normalized_url);
CREATE INDEX IF NOT EXISTS idx_signals_subject ON monitoring_signals(subject_id);
CREATE INDEX IF NOT EXISTS idx_candidate_reviews_org_status ON candidate_reviews(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_candidate_reviews_priority ON candidate_reviews(priority);
CREATE INDEX IF NOT EXISTS idx_signal_case_links_case ON signal_case_links(case_id);
CREATE INDEX IF NOT EXISTS idx_candidate_correlations_subject ON candidate_correlations(subject_id);
