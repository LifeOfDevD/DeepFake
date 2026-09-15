import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 7 Migrations (Evaluation Quality & Red-Team)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('verifies that all Phase 7 evaluation tables are created', () => {
    const tables = [
      'evaluation_datasets',
      'evaluation_fixtures',
      'ground_truth_labels',
      'fixture_adjudications',
      'ruleset_versions',
      'ruleset_activations',
      'evaluation_runs',
      'evaluation_run_metrics',
      'suppression_rules',
      'reviewer_evaluations',
      'red_team_test_runs',
      'intelligence_provider_analyses'
    ];

    for (const table of tables) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(table) as { name: string } | undefined;
      expect(row, `Table ${table} should exist`).toBeDefined();
      expect(row?.name).toBe(table);
    }
  });

  it('verifies evaluation dataset and fixture cascade deletion', () => {
    // Insert prerequisite organization and user
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_eval_01', 'Eval Test Org', 'eval-org', 'healthcare', 'IN-DL', 'eval@test.in')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ('usr_eval_01', 'evaluator@test.in', 'Evaluator User', 'hash123')
    `).run();

    // Create dataset
    db.prepare(`
      INSERT INTO evaluation_datasets (id, name, version, description, created_by_user_id)
      VALUES ('ds_eval_001', 'Golden Dataset v1', 'v1.0.0', 'Baseline test fixtures', 'usr_eval_01')
    `).run();

    // Create fixture
    db.prepare(`
      INSERT INTO evaluation_fixtures (
        id, dataset_id, scenario_category, synthetic_subject, synthetic_platform,
        normalized_url, observed_url, expected_correlation_outcome, expected_risk_band
      ) VALUES (
        'fix_eval_001', 'ds_eval_001', 'exact_handle_impersonation',
        '{"canonical_name":"Dr. Test"}', 'instagram',
        'https://instagram.com/dr_test_fake', 'https://instagram.com/dr_test_fake',
        'match', 'urgent'
      )
    `).run();

    // Add ground truth label
    db.prepare(`
      INSERT INTO ground_truth_labels (id, fixture_id, reviewer_user_id, reviewer_email, label, rationale)
      VALUES ('gtl_001', 'fix_eval_001', 'usr_eval_01', 'evaluator@test.in', 'confirmed_candidate', 'Clear impersonation match')
    `).run();

    expect(db.prepare('SELECT COUNT(*) as count FROM evaluation_fixtures').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) as count FROM ground_truth_labels').get()).toEqual({ count: 1 });

    // Delete dataset -> fixtures and labels must cascade delete
    db.prepare('DELETE FROM evaluation_datasets WHERE id = ?').run('ds_eval_001');

    expect(db.prepare('SELECT COUNT(*) as count FROM evaluation_fixtures').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) as count FROM ground_truth_labels').get()).toEqual({ count: 0 });
  });

  it('verifies ruleset version unique constraint on version_tag', () => {
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ('usr_eval_02', 'ruleset_admin@test.in', 'Ruleset Admin', 'hash123')
    `).run();

    db.prepare(`
      INSERT INTO ruleset_versions (
        id, version_tag, name, factor_weights, threshold_presets, band_cutoffs, status, checksum, created_by_user_id
      ) VALUES (
        'rs_001', 'v1.0.0', 'Baseline Ruleset', '{}', '{}', '{}', 'active', 'chk123', 'usr_eval_02'
      )
    `).run();

    // Inserting duplicate version_tag must throw UNIQUE constraint error
    expect(() => {
      db.prepare(`
        INSERT INTO ruleset_versions (
          id, version_tag, name, factor_weights, threshold_presets, band_cutoffs, status, checksum, created_by_user_id
        ) VALUES (
          'rs_002', 'v1.0.0', 'Duplicate Tag Ruleset', '{}', '{}', '{}', 'draft', 'chk456', 'usr_eval_02'
        )
      `).run();
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('verifies suppression rule creation and expiry storage', () => {
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_suppr_01', 'Suppression Org', 'suppr-org', 'financial_services', 'IN-MH', 'suppr@test.in')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ('usr_suppr_01', 'suppr_owner@test.in', 'Suppression Owner', 'hash123')
    `).run();

    const futureExpiry = new Date(Date.now() + 30 * 86400 * 1000).toISOString();

    db.prepare(`
      INSERT INTO suppression_rules (
        id, organization_id, name, rule_type, pattern, pattern_type, owner_user_id, justification, expires_at
      ) VALUES (
        'sup_001', 'org_suppr_01', 'Official Support Handle Exemption', 'verified_official',
        '@support_apex_official', 'handle', 'usr_suppr_01', 'Verified customer care handle', ?
      )
    `).run(futureExpiry);

    const rule = db.prepare('SELECT * FROM suppression_rules WHERE id = ?').get('sup_001') as any;
    expect(rule).toBeDefined();
    expect(rule.rule_type).toBe('verified_official');
    expect(rule.pattern).toBe('@support_apex_official');
    expect(rule.is_active).toBe(1);
    expect(rule.expires_at).toBe(futureExpiry);
  });

  it('verifies performance indexes exist on critical evaluation tables', () => {
    const indexes = [
      'idx_eval_fixtures_dataset',
      'idx_eval_fixtures_category',
      'idx_ground_truth_fixture',
      'idx_ground_truth_reviewer',
      'idx_fixture_adjudications_fixture',
      'idx_ruleset_versions_status',
      'idx_ruleset_activations_org',
      'idx_eval_runs_org',
      'idx_eval_metrics_run',
      'idx_suppression_rules_org',
      'idx_reviewer_evals_org',
      'idx_red_team_category',
      'idx_provider_analyses_signal'
    ];

    for (const idx of indexes) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
        .get(idx) as { name: string } | undefined;
      expect(row, `Index ${idx} should exist`).toBeDefined();
    }
  });
});
