-- ============================================================================
-- MIGRATION 0008: PHASE 7 EVALUATION QUALITY, FALSE-POSITIVE REDUCTION,
-- RED-TEAM TESTING & SAFE INTELLIGENCE ENRICHMENT
-- ============================================================================

-- 1. Evaluation Datasets Table
CREATE TABLE IF NOT EXISTS evaluation_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  target_subject_types TEXT NOT NULL DEFAULT '[]',
  scenario_categories TEXT NOT NULL DEFAULT '[]',
  difficulty_distribution TEXT NOT NULL DEFAULT '{}',
  total_fixtures INTEGER NOT NULL DEFAULT 0,
  is_golden INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(name, version)
);

-- 2. Evaluation Fixtures Table
CREATE TABLE IF NOT EXISTS evaluation_fixtures (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES evaluation_datasets(id) ON DELETE CASCADE,
  scenario_category TEXT NOT NULL,
  synthetic_subject TEXT NOT NULL, -- JSON { canonical_name, subject_type, official_domains, official_social_urls }
  synthetic_platform TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  observed_url TEXT NOT NULL,
  signal_metadata TEXT NOT NULL DEFAULT '{}',
  expected_correlation_outcome TEXT NOT NULL, -- 'match', 'no_match', 'ambiguous'
  expected_risk_band TEXT NOT NULL, -- 'informational', 'low', 'medium', 'high', 'urgent'
  expected_false_positive_label TEXT, -- 'satire_parody', 'authorized_affiliate', etc.
  expected_human_review_requirement INTEGER NOT NULL DEFAULT 1,
  difficulty_level TEXT NOT NULL DEFAULT 'medium', -- 'easy', 'medium', 'hard', 'adversarial'
  language_or_script TEXT NOT NULL DEFAULT 'en',
  dataset_version TEXT NOT NULL DEFAULT 'v1.0',
  provenance TEXT NOT NULL DEFAULT '{}',
  reviewer_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Ground-Truth Labels Table (Immutable append-only review history)
CREATE TABLE IF NOT EXISTS ground_truth_labels (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES evaluation_fixtures(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_email TEXT NOT NULL,
  label TEXT NOT NULL, -- 'confirmed_candidate', 'benign_authorized', 'false_positive', 'uncertain', 'insufficient_information', 'out_of_scope'
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  label_version INTEGER NOT NULL DEFAULT 1,
  is_adjudicated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Fixture Adjudications Table (Conflict resolutions for multi-reviewer fixtures)
CREATE TABLE IF NOT EXISTS fixture_adjudications (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES evaluation_fixtures(id) ON DELETE CASCADE,
  adjudicator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  adjudicator_email TEXT NOT NULL,
  resolved_label TEXT NOT NULL,
  rationale TEXT NOT NULL,
  conflicting_label_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of ground_truth_labels ids
  statutory_notes TEXT,
  adjudicated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Ruleset Versions Table (Versioned scoring parameter presets)
CREATE TABLE IF NOT EXISTS ruleset_versions (
  id TEXT PRIMARY KEY,
  version_tag TEXT NOT NULL UNIQUE, -- e.g. 'v1.0.0-baseline', 'v1.1.0-calibrated'
  name TEXT NOT NULL,
  description TEXT,
  factor_weights TEXT NOT NULL, -- JSON { identity_weight, domain_weight, content_weight, brand_weight, ... }
  threshold_presets TEXT NOT NULL, -- JSON { alert_threshold, auto_link_threshold, human_review_threshold }
  band_cutoffs TEXT NOT NULL, -- JSON { informational_max: 19, low_max: 39, medium_max: 69, high_max: 84, urgent_max: 100 }
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'proposed', 'approved', 'active', 'retired', 'rolled_back'
  checksum TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Ruleset Activations Table (Audit trail of active rulesets per tenant)
CREATE TABLE IF NOT EXISTS ruleset_activations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ruleset_id TEXT NOT NULL REFERENCES ruleset_versions(id) ON DELETE RESTRICT,
  previous_ruleset_id TEXT REFERENCES ruleset_versions(id) ON DELETE SET NULL,
  activated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activation_reason TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  activated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deactivated_at TEXT
);

-- 7. Evaluation Runs Table
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  dataset_id TEXT NOT NULL REFERENCES evaluation_datasets(id) ON DELETE RESTRICT,
  ruleset_id TEXT NOT NULL REFERENCES ruleset_versions(id) ON DELETE RESTRICT,
  run_type TEXT NOT NULL DEFAULT 'offline_validation', -- 'offline_validation', 'what_if_simulation', 'regression_check'
  total_evaluated INTEGER NOT NULL DEFAULT 0,
  executed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  execution_duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed', -- 'running', 'completed', 'failed'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 8. Evaluation Run Metrics Table (Global and sliced metrics)
CREATE TABLE IF NOT EXISTS evaluation_run_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  slice_dimension TEXT NOT NULL DEFAULT 'global', -- 'global', 'platform', 'subject_type', 'scenario_category', 'score_band', 'language'
  slice_value TEXT NOT NULL DEFAULT 'all',
  total_signals INTEGER NOT NULL DEFAULT 0,
  true_positives INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  true_negatives INTEGER NOT NULL DEFAULT 0,
  false_negatives INTEGER NOT NULL DEFAULT 0,
  precision REAL NOT NULL DEFAULT 0.0,
  recall REAL NOT NULL DEFAULT 0.0,
  false_positive_rate REAL NOT NULL DEFAULT 0.0,
  false_negative_rate REAL NOT NULL DEFAULT 0.0,
  precision_at_top_k REAL NOT NULL DEFAULT 0.0,
  queue_yield REAL NOT NULL DEFAULT 0.0,
  brier_calibration_score REAL NOT NULL DEFAULT 0.0,
  avg_review_time_ms REAL NOT NULL DEFAULT 0.0,
  duplicate_suppression_rate REAL NOT NULL DEFAULT 0.0,
  normalization_success_rate REAL NOT NULL DEFAULT 1.0,
  adapter_rejection_rate REAL NOT NULL DEFAULT 0.0,
  latency_p50_ms REAL NOT NULL DEFAULT 0.0,
  latency_p95_ms REAL NOT NULL DEFAULT 0.0,
  latency_p99_ms REAL NOT NULL DEFAULT 0.0,
  cost_per_signal_inr REAL NOT NULL DEFAULT 0.0,
  confirmed_case_conversion_rate REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 9. False-Positive Suppression Rules Table (Tenant-scoped, expiring)
CREATE TABLE IF NOT EXISTS suppression_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL, -- 'verified_official', 'authorized_partner', 'fan_page', 'parody_satire', 'criticism_commentary', 'news_reporting', 'unrelated_same_name', 'previously_dismissed_pattern', 'known_benign_domain'
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL, -- 'exact_url', 'domain_glob', 'handle', 'keyword'
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  justification TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  override_count INTEGER NOT NULL DEFAULT 0,
  evaluation_tested INTEGER NOT NULL DEFAULT 0,
  ruleset_version TEXT NOT NULL DEFAULT 'v1.0',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 10. Reviewer Quality Telemetry Table
CREATE TABLE IF NOT EXISTS reviewer_evaluations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  dismissed_count INTEGER NOT NULL DEFAULT 0,
  quarantined_count INTEGER NOT NULL DEFAULT 0,
  disagreement_count INTEGER NOT NULL DEFAULT 0,
  override_count INTEGER NOT NULL DEFAULT 0,
  avg_duration_seconds REAL NOT NULL DEFAULT 0.0,
  sampled_for_second_review INTEGER NOT NULL DEFAULT 0,
  coaching_notes TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 11. Red-Team Test Runs Table
CREATE TABLE IF NOT EXISTS red_team_test_runs (
  id TEXT PRIMARY KEY,
  test_vector_category TEXT NOT NULL,
  vector_name TEXT NOT NULL,
  input_payload TEXT NOT NULL,
  expected_defense_behavior TEXT NOT NULL,
  actual_behavior TEXT NOT NULL,
  defended_successfully INTEGER NOT NULL DEFAULT 1,
  vulnerability_severity TEXT NOT NULL DEFAULT 'none', -- 'none', 'low', 'medium', 'high', 'critical'
  remediation_notes TEXT,
  executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 12. Local Intelligence Provider Analyses Table
CREATE TABLE IF NOT EXISTS intelligence_provider_analyses (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES monitoring_signals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL DEFAULT 'local_deterministic_v1',
  provider_version TEXT NOT NULL DEFAULT '1.0.0',
  analysis_summary TEXT NOT NULL,
  feature_breakdown TEXT NOT NULL DEFAULT '{}',
  confidence_bounds TEXT NOT NULL DEFAULT '{}', -- JSON { lower: 0.1, upper: 0.9 }
  statutory_disclaimer TEXT NOT NULL,
  analyzed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE & AUDITING
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_eval_fixtures_dataset ON evaluation_fixtures(dataset_id);
CREATE INDEX IF NOT EXISTS idx_eval_fixtures_category ON evaluation_fixtures(scenario_category);
CREATE INDEX IF NOT EXISTS idx_ground_truth_fixture ON ground_truth_labels(fixture_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_reviewer ON ground_truth_labels(reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_fixture_adjudications_fixture ON fixture_adjudications(fixture_id);
CREATE INDEX IF NOT EXISTS idx_ruleset_versions_status ON ruleset_versions(status);
CREATE INDEX IF NOT EXISTS idx_ruleset_activations_org ON ruleset_activations(organization_id, is_current);
CREATE INDEX IF NOT EXISTS idx_eval_runs_org ON evaluation_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_eval_metrics_run ON evaluation_run_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_suppression_rules_org ON suppression_rules(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_reviewer_evals_org ON reviewer_evaluations(organization_id, reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_red_team_category ON red_team_test_runs(test_vector_category);
CREATE INDEX IF NOT EXISTS idx_provider_analyses_signal ON intelligence_provider_analyses(signal_id);
