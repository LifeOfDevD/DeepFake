import Database from 'better-sqlite3';
import { getDatabase } from '../../db/connection.js';
import { CreateRulesetVersionInput } from '../../domain/types.js';

export interface FeedbackSummary {
  organizationId: string;
  totalDecisionsAnalyzed: number;
  confirmedCount: number;
  dismissedCount: number;
  topFalsePositiveCategories: Record<string, number>;
  recommendedThresholdAdjustments: {
    proposedAlertThreshold: number;
    proposedHumanReviewThreshold: number;
    rationale: string;
  };
  proposedRulesetDraft?: CreateRulesetVersionInput;
  proposedSuppressionCandidates: Array<{
    name: string;
    pattern: string;
    pattern_type: 'exact_url' | 'handle' | 'keyword';
    rule_type: string;
    occurrenceCount: number;
  }>;
}

export class FeedbackPipelineService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Analyzes historical human analyst decisions and synthesizes proposed improvements.
   * STRICT SAFETY GUARANTEE: Never modifies live production scoring parameters silently.
   */
  public generateFeedbackProposals(organizationId: string): FeedbackSummary {
    const reviews = this.db.prepare(`
      SELECT r.*, s.observed_url, s.normalized_url, s.platform
      FROM candidate_reviews r
      JOIN monitoring_signals s ON r.signal_id = s.id
      WHERE r.organization_id = ? AND r.status IN ('confirmed', 'dismissed')
    `).all(organizationId) as any[];

    let confirmedCount = 0;
    let dismissedCount = 0;
    const fpCategories: Record<string, number> = {};
    const dismissedHandles: Record<string, number> = {};

    for (const r of reviews) {
      if (r.status === 'confirmed') {
        confirmedCount++;
      } else if (r.status === 'dismissed') {
        dismissedCount++;
        const fp = r.false_positive_category || 'unspecified_benign';
        fpCategories[fp] = (fpCategories[fp] || 0) + 1;

        // Track pattern candidates
        try {
          const urlObj = new URL(r.normalized_url);
          const handle = urlObj.pathname.split('/')[1];
          if (handle && handle.length > 3) {
            dismissedHandles[handle] = (dismissedHandles[handle] || 0) + 1;
          }
        } catch {
          // ignore
        }
      }
    }

    const total = reviews.length;
    const fpRatio = total > 0 ? (dismissedCount / total) : 0;

    // Propose threshold tuning if false positive ratio is high
    let proposedAlert = 0.70;
    let rationale = 'Default baseline threshold calibrated for balanced precision and recall.';

    if (fpRatio > 0.40) {
      proposedAlert = 0.75;
      rationale = `High false-positive rate (${Math.round(fpRatio * 100)}%) observed in queue. Recommend increasing alert threshold to 0.75 to reduce operator queue burden.`;
    } else if (fpRatio < 0.15 && confirmedCount > 10) {
      proposedAlert = 0.65;
      rationale = `Very high review yield (${Math.round((1 - fpRatio) * 100)}%). Recommend lowering alert threshold to 0.65 to capture edge-case candidates.`;
    }

    // Proposed suppression candidates with recurrence >= 2
    const proposedSuppressions = Object.entries(dismissedHandles)
      .filter(([_, count]) => count >= 2)
      .map(([handle, count]) => ({
        name: `Auto-proposed suppression for recurring dismissed handle @${handle}`,
        pattern: handle,
        pattern_type: 'handle' as const,
        rule_type: 'previously_dismissed_pattern',
        occurrenceCount: count
      }));

    // Draft proposed ruleset version
    const proposedRuleset: CreateRulesetVersionInput = {
      version_tag: `v${new Date().getFullYear()}.${new Date().getMonth() + 1}-feedback-proposal`,
      name: `Feedback-Informed Calibrated Ruleset (${organizationId})`,
      description: `Proposed scoring ruleset generated from ${total} analyst decisions (${confirmedCount} confirmed, ${dismissedCount} dismissed). Requires offline evaluation and approval before activation.`,
      factor_weights: {
        exact_handle_weight: 25,
        name_alias_weight: 10,
        domain_similarity_weight: 25,
        scam_keywords_weight: 25,
        brand_asset_weight: 15,
        prior_violation_multiplier: 1.25,
        parody_discount_multiplier: 0.5
      },
      threshold_presets: {
        alert_threshold: proposedAlert,
        auto_link_threshold: 0.85,
        human_review_threshold: 0.30
      },
      band_cutoffs: {
        informational_max: 19,
        low_max: 39,
        medium_max: 69,
        high_max: 84,
        urgent_max: 100
      }
    };

    return {
      organizationId,
      totalDecisionsAnalyzed: total,
      confirmedCount,
      dismissedCount,
      topFalsePositiveCategories: fpCategories,
      recommendedThresholdAdjustments: {
        proposedAlertThreshold: proposedAlert,
        proposedHumanReviewThreshold: 0.30,
        rationale
      },
      proposedRulesetDraft: proposedRuleset,
      proposedSuppressionCandidates: proposedSuppressions
    };
  }
}
