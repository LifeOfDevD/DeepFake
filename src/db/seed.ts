import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './connection.js';
import { runMigrations } from './migrate.js';

export function seedDemoData(dbInstance?: Database.Database): void {
  const db = dbInstance || getDatabase();

  // Run migrations first
  runMigrations(db);

  // Read fixtures JSON
  const fixturesPath = path.resolve(process.cwd(), 'seeds/demo-fixtures.json');
  if (!fs.existsSync(fixturesPath)) {
    throw new Error(`Fixtures file not found at ${fixturesPath}`);
  }

  const rawData = fs.readFileSync(fixturesPath, 'utf8');
  const fixtures = JSON.parse(rawData);

  const resetAndSeed = db.transaction(() => {
    // Clear existing data safely in reverse dependency order
    const tablesToClear = [
      'intelligence_provider_analyses',
      'red_team_test_runs',
      'reviewer_evaluations',
      'suppression_rules',
      'evaluation_run_metrics',
      'evaluation_runs',
      'ruleset_activations',
      'ruleset_versions',
      'fixture_adjudications',
      'ground_truth_labels',
      'evaluation_fixtures',
      'evaluation_datasets',
      'candidate_scores',
      'candidate_review_disclaimers',
      'signal_case_links',
      'candidate_reviews',
      'candidate_correlations',
      'monitoring_signals',
      'monitoring_policies',
      'monitored_subjects',
      'usage_daily_aggregates',
      'usage_events',
      'system_backup_records',
      'outbox_notifications',
      'pilot_entitlements',
      'submission_feedback',
      'submission_state_history',
      'submission_audit_events',
      'platform_submissions',
      'evidence_custody_events',
      'evidence_items',
      'case_tasks',
      'audit_events',
      'case_notes',
      'case_status_history',
      'cases',
      'memberships',
      'users',
      'organizations'
    ];

    for (const table of tablesToClear) {
      try {
        db.prepare(`DELETE FROM ${table}`).run();
      } catch {
        // Table might not exist in partial migration states
      }
    }

    // 1. Insert Organizations
    const insertOrg = db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email, created_at, updated_at)
      VALUES (@id, @name, @slug, @industry, @jurisdiction, @primary_contact_email, @created_at, @created_at)
    `);
    const insertEntitlement = db.prepare(`
      INSERT OR IGNORE INTO pilot_entitlements (
        id, organization_id, plan_tier, pilot_start_date, pilot_end_date,
        enabled_features, max_users, max_active_cases, max_monthly_evidence_uploads,
        max_storage_bytes, max_simulated_submissions_per_month,
        max_monitored_subjects, max_monthly_monitoring_signals, created_at, updated_at
      ) VALUES (?, ?, 'pilot', ?, ?, '[]', 10, 25, 100, 5368709120, 50, 5, 500, ?, ?)
    `);

    const nowIso = new Date().toISOString();
    const endIso = new Date(Date.now() + 90 * 86400 * 1000).toISOString();

    for (const org of fixtures.organizations) {
      insertOrg.run(org);
      insertEntitlement.run(
        `ent_${org.id}`,
        org.id,
        nowIso,
        endIso,
        nowIso,
        nowIso
      );
    }

    // 2. Insert Users and Memberships
    const insertUser = db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertMembership = db.prepare(`
      INSERT INTO memberships (id, user_id, organization_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const user of fixtures.users) {
      insertUser.run(
        user.id,
        user.email,
        user.full_name,
        'pbkdf2_mock_hash_for_testing',
        user.system_role || 'user',
        user.created_at,
        user.created_at
      );

      if (user.organization_id && user.role) {
        insertMembership.run(
          `mem_${user.id}_${user.organization_id}`,
          user.id,
          user.organization_id,
          user.role,
          user.created_at
        );
      }
    }

    // 3. Insert Cases
    const insertCase = db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        @id, @organization_id, @case_number, @title, @category, @priority, @status,
        @target_entity, @contested_url, @hosting_platform, @reported_by_email,
        @assigned_to_user_id, @requires_legal_review, @statutory_basis, @created_at, @updated_at
      )
    `);

    for (const c of fixtures.cases) {
      insertCase.run({
        ...c,
        requires_legal_review: c.requires_legal_review ? 1 : 0,
        statutory_basis: JSON.stringify(c.statutory_basis || [])
      });
    }

    // 4. Insert Case Notes
    if (fixtures.case_notes) {
      const insertNote = db.prepare(`
        INSERT INTO case_notes (id, case_id, organization_id, author_user_id, author_name, content, is_internal_only, created_at)
        VALUES (?, ?, (SELECT organization_id FROM cases WHERE id = ?), ?, ?, ?, ?, ?)
      `);
      for (const note of fixtures.case_notes) {
        insertNote.run(
          note.id,
          note.case_id,
          note.case_id,
          note.author_user_id,
          note.author_name,
          note.content,
          note.is_internal_only ? 1 : 0,
          note.created_at
        );
      }
    }

    // 5. Insert Audit Events
    if (fixtures.audit_events) {
      const insertAudit = db.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_user_id, actor_email, action, resource_type, resource_id, details, ip_address, created_at)
        VALUES (@id, @organization_id, @actor_user_id, @actor_email, @action, @resource_type, @resource_id, @details, @ip_address, @created_at)
      `);
      for (const aud of fixtures.audit_events) {
        insertAudit.run({
          ...aud,
          details: typeof aud.details === 'string' ? aud.details : JSON.stringify(aud.details)
        });
      }
    }
  });

  resetAndSeed();
}

// Standalone execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Seeding synthetic demo fixtures into SQLite...');
  seedDemoData();
  console.log('Seed completed successfully. Zero real PII present.');
}
