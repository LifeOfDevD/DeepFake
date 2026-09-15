import crypto from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  RulesetVersion,
  CreateRulesetVersionInput,
  CreateRulesetVersionSchema,
  RulesetWeights,
  RulesetThresholds,
  EvaluationFixture
} from '../../domain/types.js';

export interface RulesetSimulationResult {
  ruleset_id: string;
  version_tag: string;
  total_evaluated: number;
  simulated_alerts: number;
  simulated_cases: number;
  simulated_false_positive_suppressions: number;
  average_simulated_score: number;
  score_band_distribution: Record<string, number>;
  projected_queue_yield: number;
}

export const DEFAULT_RULESET_WEIGHTS: RulesetWeights = {
  exact_handle_weight: 25,
  name_alias_weight: 10,
  domain_similarity_weight: 25,
  scam_keywords_weight: 25,
  brand_asset_weight: 15,
  prior_violation_multiplier: 1.25,
  parody_discount_multiplier: 0.5
};

export const DEFAULT_RULESET_THRESHOLDS: RulesetThresholds = {
  alert_threshold: 0.70,
  auto_link_threshold: 0.85,
  human_review_threshold: 0.30
};

export class RulesetVersionService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Computes a deterministic SHA-256 checksum for a ruleset configuration
   */
  public computeChecksum(weights: RulesetWeights, thresholds: RulesetThresholds, bandCutoffs: Record<string, number>): string {
    const canonical = JSON.stringify({
      weights: Object.keys(weights).sort().reduce((acc, k) => ({ ...acc, [k]: (weights as any)[k] }), {}),
      thresholds: Object.keys(thresholds).sort().reduce((acc, k) => ({ ...acc, [k]: (thresholds as any)[k] }), {}),
      bandCutoffs: Object.keys(bandCutoffs).sort().reduce((acc, k) => ({ ...acc, [k]: bandCutoffs[k] }), {})
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Creates a new ruleset version in draft status
   */
  public createRuleset(input: Partial<CreateRulesetVersionInput> & { name?: string; ruleset_name?: string; version_tag?: string }, creatorUserId: string): RulesetVersion {
    const validated = CreateRulesetVersionSchema.parse({
      version_tag: input.version_tag || `v1.${uuidv4().replace(/-/g, '').slice(0, 8)}`,
      name: input.name || input.ruleset_name || 'Ruleset Default',
      description: input.description,
      factor_weights: { ...DEFAULT_RULESET_WEIGHTS, ...(input.factor_weights || {}) },
      threshold_presets: { ...DEFAULT_RULESET_THRESHOLDS, ...(input.threshold_presets || {}) },
      band_cutoffs: input.band_cutoffs || {
        informational_max: 19,
        low_max: 39,
        medium_max: 69,
        high_max: 84,
        urgent_max: 100
      }
    });

    const id = `rs_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const checksum = this.computeChecksum(validated.factor_weights, validated.threshold_presets, validated.band_cutoffs);

    this.db.prepare(`
      INSERT INTO ruleset_versions (
        id, version_tag, name, description, factor_weights,
        threshold_presets, band_cutoffs, status, checksum,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      id,
      validated.version_tag,
      validated.name,
      validated.description || null,
      JSON.stringify(validated.factor_weights),
      JSON.stringify(validated.threshold_presets),
      JSON.stringify(validated.band_cutoffs),
      checksum,
      creatorUserId,
      now,
      now
    );

    return this.getRulesetById(id)!;
  }

  public getRulesetById(id: string): RulesetVersion | null {
    const row = this.db.prepare('SELECT * FROM ruleset_versions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRowToRuleset(row);
  }

  public getRulesetByTag(tag: string): RulesetVersion | null {
    const row = this.db.prepare('SELECT * FROM ruleset_versions WHERE version_tag = ?').get(tag) as any;
    if (!row) return null;
    return this.mapRowToRuleset(row);
  }

  public listRulesets(): RulesetVersion[] {
    const rows = this.db.prepare('SELECT * FROM ruleset_versions ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => this.mapRowToRuleset(r));
  }

  /**
   * Approves a proposed ruleset version
   */
  public approveRuleset(id: string, approverUserId: string): RulesetVersion {
    const ruleset = this.getRulesetById(id);
    if (!ruleset) {
      throw new Error(`NOT_FOUND: Ruleset ${id} not found`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE ruleset_versions
      SET status = 'approved', approved_by_user_id = ?, approved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(approverUserId, now, now, id);

    return this.getRulesetById(id)!;
  }

  /**
   * Activates a ruleset version for an organization, archiving previous active ruleset
   */
  public activateRuleset(organizationId: string, rulesetId: string, actorUserId: string, reason: string): RulesetVersion {
    const ruleset = this.getRulesetById(rulesetId);
    if (!ruleset) {
      throw new Error(`NOT_FOUND: Ruleset ${rulesetId} not found`);
    }

    if (ruleset.status !== 'approved' && ruleset.status !== 'active') {
      throw new Error(`RULESET_NOT_APPROVED: Ruleset must be in 'approved' status before activation. Current: ${ruleset.status}`);
    }

    const currentActivation = this.db.prepare(`
      SELECT ruleset_id FROM ruleset_activations
      WHERE organization_id = ? AND is_current = 1
    `).get(organizationId) as { ruleset_id?: string } | undefined;

    const previousRulesetId = currentActivation?.ruleset_id || null;
    const activationId = `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      // 1. Deactivate current active ruleset record
      this.db.prepare(`
        UPDATE ruleset_activations
        SET is_current = 0, deactivated_at = ?
        WHERE organization_id = ? AND is_current = 1
      `).run(now, organizationId);

      // 2. Insert new current activation record
      this.db.prepare(`
        INSERT INTO ruleset_activations (
          id, organization_id, ruleset_id, previous_ruleset_id,
          activated_by_user_id, activation_reason, is_current, activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        activationId,
        organizationId,
        rulesetId,
        previousRulesetId,
        actorUserId,
        reason,
        now
      );

      // 3. Update ruleset status to active
      this.db.prepare(`
        UPDATE ruleset_versions
        SET status = 'active', updated_at = ?
        WHERE id = ?
      `).run(now, rulesetId);
    });

    tx();

    return this.getRulesetById(rulesetId)!;
  }

  /**
   * Rolls back to the previously active ruleset version
   */
  public rollbackRuleset(organizationId: string, actorUserId: string, reason: string): RulesetVersion {
    const currentActivation = this.db.prepare(`
      SELECT * FROM ruleset_activations
      WHERE organization_id = ? AND is_current = 1
    `).get(organizationId) as any;

    if (!currentActivation || !currentActivation.previous_ruleset_id) {
      throw new Error(`NO_ROLLBACK_TARGET: No previous ruleset activation found for organization ${organizationId}`);
    }

    const previousRulesetId = currentActivation.previous_ruleset_id;
    const now = new Date().toISOString();
    const rollbackActId = `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const tx = this.db.transaction(() => {
      // Deactivate current
      this.db.prepare(`
        UPDATE ruleset_activations
        SET is_current = 0, deactivated_at = ?
        WHERE id = ?
      `).run(now, currentActivation.id);

      // Mark current ruleset as rolled_back
      this.db.prepare(`
        UPDATE ruleset_versions
        SET status = 'rolled_back', updated_at = ?
        WHERE id = ?
      `).run(now, currentActivation.ruleset_id);

      // Activate previous ruleset
      this.db.prepare(`
        INSERT INTO ruleset_activations (
          id, organization_id, ruleset_id, previous_ruleset_id,
          activated_by_user_id, activation_reason, is_current, activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        rollbackActId,
        organizationId,
        previousRulesetId,
        currentActivation.ruleset_id,
        actorUserId,
        `Rollback from ${currentActivation.ruleset_id}: ${reason}`,
        now
      );

      // Mark rolled-back-to ruleset as active
      this.db.prepare(`
        UPDATE ruleset_versions
        SET status = 'active', updated_at = ?
        WHERE id = ?
      `).run(now, previousRulesetId);
    });

    tx();

    return this.getRulesetById(previousRulesetId)!;
  }

  /**
   * Retrieves the currently active ruleset for an organization (with fallback to default)
   */
  public getActiveRuleset(organizationId: string): RulesetVersion {
    return this.getActiveRulesetForOrg(organizationId);
  }

  public getActiveRulesetForOrg(organizationId: string): RulesetVersion {
    const activeAct = this.db.prepare(`
      SELECT r.* FROM ruleset_versions r
      JOIN ruleset_activations a ON r.id = a.ruleset_id
      WHERE a.organization_id = ? AND a.is_current = 1
    `).get(organizationId) as any;

    if (activeAct) {
      return this.mapRowToRuleset(activeAct);
    }

    // Fallback to latest global active or default ruleset
    const fallback = this.db.prepare(`
      SELECT * FROM ruleset_versions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    if (fallback) {
      return this.mapRowToRuleset(fallback);
    }

    // Default programmatic fallback
    return {
      id: 'rs_default_v1',
      version_tag: 'v1.0.0-default',
      name: 'Default Baseline Ruleset',
      description: 'Standard deterministic risk scoring ruleset',
      factor_weights: DEFAULT_RULESET_WEIGHTS,
      threshold_presets: DEFAULT_RULESET_THRESHOLDS,
      band_cutoffs: {
        informational_max: 19,
        low_max: 39,
        medium_max: 69,
        high_max: 84,
        urgent_max: 100
      },
      status: 'active',
      checksum: this.computeChecksum(DEFAULT_RULESET_WEIGHTS, DEFAULT_RULESET_THRESHOLDS, {
        informational_max: 19,
        low_max: 39,
        medium_max: 69,
        high_max: 84,
        urgent_max: 100
      }),
      created_by_user_id: 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Executes an offline "what-if" threshold simulation against synthetic fixtures
   */
  public simulateRuleset(
    ruleset: RulesetVersion,
    fixtures: EvaluationFixture[],
    overrideThresholds?: Partial<RulesetThresholds>
  ): RulesetSimulationResult {
    const thresholds: RulesetThresholds = {
      ...ruleset.threshold_presets,
      ...overrideThresholds
    };

    let totalScore = 0;
    let alerts = 0;
    let cases = 0;
    let suppressions = 0;
    const bandDistribution: Record<string, number> = {
      informational: 0,
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0
    };

    for (const fix of fixtures) {
      // Calculate simulated score using ruleset weights
      const score = this.calculateSimulatedScore(fix, ruleset.factor_weights);
      totalScore += score;

      const band = this.getScoreBand(score, ruleset.band_cutoffs);
      bandDistribution[band] = (bandDistribution[band] || 0) + 1;

      const alertCutoff = thresholds.alert_threshold * 100;
      const caseCutoff = thresholds.auto_link_threshold * 100;

      if (score >= alertCutoff) {
        alerts++;
      }
      if (score >= caseCutoff) {
        cases++;
      }
      if (fix.expected_false_positive_label && score < alertCutoff) {
        suppressions++;
      }
    }

    const totalEvaluated = fixtures.length;
    const averageScore = totalEvaluated > 0 ? totalScore / totalEvaluated : 0;
    const projectedYield = alerts > 0 ? (cases / alerts) : 0;

    return {
      ruleset_id: ruleset.id,
      version_tag: ruleset.version_tag,
      total_evaluated: totalEvaluated,
      simulated_alerts: alerts,
      simulated_cases: cases,
      simulated_false_positive_suppressions: suppressions,
      average_simulated_score: Math.round(averageScore * 100) / 100,
      score_band_distribution: bandDistribution,
      projected_queue_yield: Math.round(projectedYield * 1000) / 1000
    };
  }

  private calculateSimulatedScore(fixture: EvaluationFixture, weights: RulesetWeights): number {
    const url = fixture.normalized_url.toLowerCase();
    const meta = JSON.stringify(fixture.signal_metadata).toLowerCase();
    const subject = fixture.synthetic_subject;

    // Check official match
    const isOfficialDomain = subject.official_domains.some((d) => url.includes(d.toLowerCase()));
    const isOfficialSocial = subject.official_social_urls.some((u) => url === u.toLowerCase());
    if (isOfficialDomain || isOfficialSocial) {
      return 0;
    }

    let identityScore = 0;
    const canonicalLower = subject.canonical_name.toLowerCase();
    if (url.includes(canonicalLower.replace(/\s+/g, '')) || (subject.handles && subject.handles.some((h) => url.includes(h.toLowerCase())))) {
      identityScore += weights.exact_handle_weight;
    } else if (canonicalLower.split(/\s+/).some((token) => token.length > 3 && (url.includes(token) || meta.includes(token)))) {
      identityScore += weights.name_alias_weight;
    }

    let domainScore = 0;
    if (fixture.synthetic_platform === 'web_domain' && (url.includes('login') || url.includes('verification') || url.includes('-scam') || url.includes('mirror'))) {
      domainScore += weights.domain_similarity_weight;
    }

    let contentScore = 0;
    const scamKeywords = ['cure', 'miracle', '500%', 'giveaway', 'wire', 'secret', 'upi', 'guarantee', 'pills'];
    if (scamKeywords.some((kw) => meta.includes(kw) || url.includes(kw))) {
      contentScore += weights.scam_keywords_weight;
    }

    let brandScore = 0;
    if (fixture.scenario_category === 'fake_doctor_endorsement' || fixture.scenario_category === 'synthetic_media_metadata_candidate') {
      brandScore += weights.brand_asset_weight;
    }

    let rawScore = identityScore + domainScore + contentScore + brandScore;

    // Parody discount
    const parodyKeywords = ['parody', 'satire', 'fan page', 'fan club', 'humour', 'memes', 'not affiliated'];
    if (parodyKeywords.some((kw) => meta.includes(kw) || url.includes(kw))) {
      rawScore = rawScore * weights.parody_discount_multiplier;
    }

    return Math.min(100, Math.max(0, Math.round(rawScore)));
  }

  private getScoreBand(score: number, cutoffs: Record<string, number>): string {
    const infoMax = cutoffs.informational_max ?? 19;
    const lowMax = cutoffs.low_max ?? 39;
    const medMax = cutoffs.medium_max ?? 69;
    const highMax = cutoffs.high_max ?? 84;

    if (score <= infoMax) return 'informational';
    if (score <= lowMax) return 'low';
    if (score <= medMax) return 'medium';
    if (score <= highMax) return 'high';
    return 'urgent';
  }

  private mapRowToRuleset(row: any): RulesetVersion {
    return {
      ...row,
      factor_weights: JSON.parse(row.factor_weights || '{}'),
      threshold_presets: JSON.parse(row.threshold_presets || '{}'),
      band_cutoffs: JSON.parse(row.band_cutoffs || '{}')
    };
  }

  public listActivations(organizationId: string, limit = 50): any[] {
    return this.db.prepare(`
      SELECT * FROM ruleset_activations
      WHERE organization_id = ?
      ORDER BY activated_at DESC, rowid DESC
      LIMIT ?
    `).all(organizationId, limit);
  }
}
