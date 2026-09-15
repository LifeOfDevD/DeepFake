import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { RulesetVersionService } from '../../src/services/evaluation/ruleset-version-service.js';
import { AdjudicationService } from '../../src/services/evaluation/adjudication-service.js';

describe('Unit: RulesetVersionService', () => {
  let db: any;
  let service: RulesetVersionService;
  let adjService: AdjudicationService;
  const orgId = 'org_ruleset_test';
  const creatorId = 'user_analyst_01';
  const approverId = 'user_legal_01';

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Ruleset Org', 'ruleset-org', 'tech', 'IN-DL', 'ruleset@example.com')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, system_role, is_active)
      VALUES
        (?, 'analyst@example.com', 'Analyst', 'hash', 'analyst', 1),
        (?, 'legal@example.com', 'Legal Approver', 'hash', 'legal_reviewer', 1)
    `).run(creatorId, approverId);

    service = new RulesetVersionService(db);
    adjService = new AdjudicationService(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates draft ruleset with canonical SHA-256 checksum', () => {
    const ruleset = service.createRuleset({
      name: 'Baseline Scoring Weights',
      version_tag: 'v1.0.0-draft',
      description: 'Initial calibrated weighting matrix'
    }, creatorId);

    expect(ruleset.id).toMatch(/^rs_/);
    expect(ruleset.status).toBe('draft');
    expect(ruleset.checksum).toHaveLength(64); // SHA-256 hex string
    expect(ruleset.created_by_user_id).toBe(creatorId);
    expect(ruleset.approved_by_user_id).toBeNull();
  });

  it('enforces two-role governance: requires approval before activation', () => {
    const ruleset = service.createRuleset({
      name: 'Candidate V2',
      version_tag: 'v2.0.0-candidate'
    }, creatorId);

    // Attempt activation while still in 'draft' -> should throw error
    expect(() => {
      service.activateRuleset(orgId, ruleset.id, approverId, 'Attempting early activation');
    }).toThrow(/must be in 'approved' status before activation/i);

    // Approve the ruleset
    const approved = service.approveRuleset(ruleset.id, approverId);
    expect(approved.status).toBe('approved');
    expect(approved.approved_by_user_id).toBe(approverId);
    expect(approved.approved_at).toBeDefined();

    // Now activation succeeds
    const activated = service.activateRuleset(orgId, ruleset.id, approverId, 'Promoting approved ruleset to active');
    expect(activated.status).toBe('active');

    // Confirm active ruleset for organization
    const currentActive = service.getActiveRuleset(orgId);
    expect(currentActive).toBeDefined();
    expect(currentActive!.id).toBe(ruleset.id);
  });

  it('supports instant rollback with audit trail', () => {
    // 1. Create and activate Version 1
    const rs1 = service.createRuleset({ name: 'V1 Stable', version_tag: 'v1.0.0' }, creatorId);
    service.approveRuleset(rs1.id, approverId);
    service.activateRuleset(orgId, rs1.id, approverId, 'Initial active rollout');

    expect(service.getActiveRuleset(orgId)!.id).toBe(rs1.id);

    // 2. Create and activate Version 2
    const rs2 = service.createRuleset({ name: 'V2 Experimental', version_tag: 'v2.0.0' }, creatorId);
    service.approveRuleset(rs2.id, approverId);
    service.activateRuleset(orgId, rs2.id, approverId, 'Upgraded to V2');

    expect(service.getActiveRuleset(orgId)!.id).toBe(rs2.id);

    // 3. Rollback from V2 to V1
    const rolledBack = service.rollbackRuleset(orgId, approverId, 'Regression detected in V2, rolling back to V1');
    expect(rolledBack.id).toBe(rs1.id);
    expect(rolledBack.status).toBe('active');

    // Confirm active is now V1
    expect(service.getActiveRuleset(orgId)!.id).toBe(rs1.id);

    // Check activation audit trail
    const history = service.listActivations(orgId);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[0].ruleset_id).toBe(rs1.id); // latest activation is rollback to rs1
    expect(history[0].activation_reason).toContain('Regression detected');
  });

  it('runs what-if threshold simulations without mutating live rulesets', () => {
    const ruleset = service.createRuleset({
      name: 'Simulation Target',
      version_tag: 'v1.0.0-sim'
    }, creatorId);

    const { dataset } = adjService.loadSeedCatalog(creatorId);
    const fixtures = adjService.listFixtures(dataset.id);

    // Run baseline simulation
    const baselineSim = service.simulateRuleset(ruleset, fixtures);
    expect(baselineSim.total_evaluated).toBe(fixtures.length);
    expect(typeof baselineSim.average_simulated_score).toBe('number');
    expect(baselineSim.score_band_distribution).toBeDefined();

    // Run what-if simulation with stricter alert threshold
    const strictSim = service.simulateRuleset(ruleset, fixtures, { alert_threshold: 0.95 });
    expect(strictSim.total_evaluated).toBe(fixtures.length);
    // Strict threshold should yield fewer or equal simulated alerts than baseline
    expect(strictSim.simulated_alerts).toBeLessThanOrEqual(baselineSim.simulated_alerts);

    // Verify the original ruleset remains unmodified
    const untouchedRuleset = service.getRulesetById(ruleset.id);
    expect(untouchedRuleset!.threshold_presets.alert_threshold).toBe(ruleset.threshold_presets.alert_threshold);
  });
});
