import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  CandidateRiskScore,
  RiskScoreFactorBreakdown,
  MANDATORY_SCORING_DISCLAIMER,
  SCORE_BAND_DEFINITIONS,
  ScoreBandDefinition
} from '../../domain/types.js';

export interface ScoreCalculationInput {
  signalId: string;
  hasExactHandleMatch: boolean;
  hasNameAliasMatch: boolean;
  isLookalikeDomain: boolean;
  hasScamKeywords: boolean;
  hasBrandAssetAbuse: boolean;
  hasPriorViolationHistory: boolean;
  hasParodyOrSatireIndicator: boolean;
  isOfficialDomainOrUrl: boolean;
  thresholdApplied?: number;
  rulesetIdentifier?: string;
}

export class CandidateScoringService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Calculates a transparent, multi-factor risk score for a candidate signal.
   * Every score is purely a human-review prioritization signal, NOT a legal determination.
   */
  public calculateScore(input: ScoreCalculationInput): CandidateRiskScore {
    // 1. If URL matches subject's own official domain/social URL, score is 0 (authorized)
    if (input.isOfficialDomainOrUrl) {
      const breakdown: RiskScoreFactorBreakdown = {
        identity_match_score: 0,
        domain_similarity_score: 0,
        content_impersonation_score: 0,
        brand_asset_abuse_score: 0,
        prior_violation_multiplier: 1.0,
        parody_fair_use_discount: 1.0,
        final_score: 0
      };

      return {
        id: `scr_${uuidv4().replace(/-/g, '')}`,
        signal_id: input.signalId,
        score: 0,
        score_version: 'v1.0',
        factors: breakdown,
        threshold_applied: input.thresholdApplied ?? 0.7,
        disclaimer: MANDATORY_SCORING_DISCLAIMER,
        ruleset_identifier: input.rulesetIdentifier || 'default_ruleset_v1',
        calculated_at: new Date().toISOString()
      };
    }

    // 2. Identity match component (0 - 35)
    let identityScore = 0;
    if (input.hasExactHandleMatch) {
      identityScore += 25;
    }
    if (input.hasNameAliasMatch) {
      identityScore += 10;
    }

    // 3. Domain similarity component (0 - 25)
    let domainScore = 0;
    if (input.isLookalikeDomain) {
      domainScore += 25;
    }

    // 4. Content impersonation / scam indicators (0 - 25)
    let contentScore = 0;
    if (input.hasScamKeywords) {
      contentScore += 25;
    }

    // 5. Brand asset abuse (0 - 15)
    let brandAssetScore = 0;
    if (input.hasBrandAssetAbuse) {
      brandAssetScore += 15;
    }

    // Raw score sum (max 100)
    let rawScore = identityScore + domainScore + contentScore + brandAssetScore;

    // Prior violation multiplier (1.0x to 1.25x)
    let multiplier = 1.0;
    if (input.hasPriorViolationHistory) {
      multiplier = 1.25;
      rawScore = rawScore * multiplier;
    }

    // Parody / satire discount (50% discount if explicit parody indicator found)
    let discount = 1.0;
    if (input.hasParodyOrSatireIndicator) {
      discount = 0.5;
      rawScore = rawScore * discount;
    }

    // Clamp score to [0, 100]
    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore * 10) / 10));

    const breakdown: RiskScoreFactorBreakdown = {
      identity_match_score: identityScore,
      domain_similarity_score: domainScore,
      content_impersonation_score: contentScore,
      brand_asset_abuse_score: brandAssetScore,
      prior_violation_multiplier: multiplier,
      parody_fair_use_discount: discount,
      final_score: finalScore
    };

    return {
      id: `scr_${uuidv4().replace(/-/g, '')}`,
      signal_id: input.signalId,
      score: finalScore,
      score_version: 'v1.0',
      factors: breakdown,
      threshold_applied: input.thresholdApplied ?? 0.7,
      disclaimer: MANDATORY_SCORING_DISCLAIMER,
      ruleset_identifier: input.rulesetIdentifier || 'default_ruleset_v1',
      calculated_at: new Date().toISOString()
    };
  }

  /**
   * Persists a candidate risk score record into the database
   */
  public saveScore(scoreRecord: CandidateRiskScore): void {
    this.db.prepare(`
      INSERT INTO candidate_risk_scores (
        id, signal_id, score, score_version, factors,
        threshold_applied, disclaimer, ruleset_identifier, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scoreRecord.id,
      scoreRecord.signal_id,
      scoreRecord.score,
      scoreRecord.score_version,
      JSON.stringify(scoreRecord.factors),
      scoreRecord.threshold_applied,
      scoreRecord.disclaimer,
      scoreRecord.ruleset_identifier,
      scoreRecord.calculated_at
    );
  }

  public getScoreBySignalId(signalId: string): CandidateRiskScore | null {
    const row = this.db.prepare(`
      SELECT * FROM candidate_risk_scores WHERE signal_id = ?
    `).get(signalId) as any;

    if (!row) return null;

    return {
      id: row.id,
      signal_id: row.signal_id,
      score: row.score,
      score_version: row.score_version,
      factors: JSON.parse(row.factors || '{}'),
      threshold_applied: row.threshold_applied,
      disclaimer: row.disclaimer,
      ruleset_identifier: row.ruleset_identifier,
      calculated_at: row.calculated_at
    };
  }

  /**
   * Resolves a score to its operational score band and explanation
   */
  public getScoreBand(score: number): ScoreBandDefinition {
    if (score <= 19) return SCORE_BAND_DEFINITIONS.informational;
    if (score <= 39) return SCORE_BAND_DEFINITIONS.low;
    if (score <= 69) return SCORE_BAND_DEFINITIONS.medium;
    if (score <= 84) return SCORE_BAND_DEFINITIONS.high;
    return SCORE_BAND_DEFINITIONS.urgent;
  }
}
