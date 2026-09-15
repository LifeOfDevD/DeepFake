import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  CandidateCorrelation,
  MonitoredSubject,
  MonitoringPolicy,
  MonitoringSignal
} from '../../domain/types.js';
import { CandidateScoringService } from './candidate-scoring-service.js';

export interface CorrelationResult {
  correlation: CandidateCorrelation;
  scoreId: string;
  riskScore: number;
}

export class CandidateCorrelationService {
  private db: Database.Database;
  private scoringService: CandidateScoringService;

  private static readonly PARODY_KEYWORDS = [
    'parody',
    'satire',
    'fan',
    'fanpage',
    'meme',
    'commentary',
    'not affiliated',
    'unofficial'
  ];

  private static readonly SCAM_KEYWORDS = [
    'crypto giveaway',
    'guaranteed return',
    '500%',
    'urgent wire',
    'dm for cures',
    'secret cure',
    'miracle pill',
    'claim prize',
    'whatsapp me',
    'investment scheme',
    'double your money'
  ];

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.scoringService = new CandidateScoringService(this.db);
  }

  /**
   * Correlates a candidate signal with a monitored subject and applies multi-factor rules
   */
  public correlate(
    signal: MonitoringSignal,
    subject: MonitoredSubject,
    policy?: MonitoringPolicy | null
  ): CorrelationResult {
    const matchedRules: string[] = [];
    const riskFactors: string[] = [];
    const falsePositiveIndicators: string[] = [];

    const urlLower = signal.normalized_url.toLowerCase();
    let payloadText = '';
    if (typeof signal.raw_payload === 'string') {
      payloadText = signal.raw_payload.toLowerCase();
    } else if (signal.raw_payload) {
      payloadText = JSON.stringify(signal.raw_payload).toLowerCase();
    }
    const combinedText = `${urlLower} ${payloadText}`;

    // 1. Check if official/authorized URL (exact profile or domain match, not partial substring)
    const isOfficialDomain = subject.official_domains.some((d) => {
      const cleanD = d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
      try {
        const u = new URL(signal.normalized_url);
        const host = u.hostname.replace(/^www\./, '');
        return host === cleanD || host.endsWith(`.${cleanD}`);
      } catch {
        return false;
      }
    });

    const isOfficialSocial = subject.official_social_urls.some((u) => {
      const cleanU = u.toLowerCase().replace(/\/$/, '');
      const cleanTarget = urlLower.replace(/\/$/, '');
      return cleanTarget === cleanU;
    });

    const isOfficial = isOfficialDomain || isOfficialSocial;

    if (isOfficial) {
      matchedRules.push('RULE_OFFICIAL_AUTHORIZED_URL');
      falsePositiveIndicators.push('OFFICIAL_DOMAIN_OR_PROFILE_COLLISION');
    }

    // 2. Parody / Satire keyword detection
    const hasParody = CandidateCorrelationService.PARODY_KEYWORDS.some((kw) =>
      combinedText.includes(kw)
    );
    if (hasParody) {
      matchedRules.push('RULE_PARODY_SATIRE_DETECTED');
      falsePositiveIndicators.push('EXPLICIT_PARODY_OR_FAN_INDICATOR');
    }

    // 3. Exact handle match check
    let hasExactHandleMatch = false;
    for (const handle of subject.handles) {
      const cleanHandle = handle.replace(/^@/, '').toLowerCase();
      if (cleanHandle.length >= 3 && combinedText.includes(cleanHandle)) {
        hasExactHandleMatch = true;
        matchedRules.push(`RULE_HANDLE_MATCH:${cleanHandle}`);
        riskFactors.push(`Subject handle '${cleanHandle}' identified in contested profile`);
        break;
      }
    }

    // 4. Name & Alias match check
    let hasNameAliasMatch = false;
    const nameTokens = [subject.canonical_name, ...subject.aliases]
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length >= 3);

    for (const token of nameTokens) {
      if (combinedText.includes(token)) {
        hasNameAliasMatch = true;
        matchedRules.push(`RULE_NAME_ALIAS_MATCH:${token}`);
        riskFactors.push(`Subject identity token '${token}' identified`);
        break;
      }
    }

    // 5. Lookalike Domain match check
    let isLookalikeDomain = false;
    if (signal.platform === 'domain' || signal.content_type === 'domain') {
      const isLookalike = nameTokens.some((token) => {
        const cleanToken = token.replace(/[^a-z0-9]/g, '');
        return cleanToken.length >= 4 && urlLower.includes(cleanToken) && !isOfficial;
      });
      if (isLookalike) {
        isLookalikeDomain = true;
        matchedRules.push('RULE_LOOKALIKE_DOMAIN_DETECTED');
        riskFactors.push('Look-alike domain name targeting protected entity');
      }
    }

    // 6. Scam / Financial Fraud / Medical Impersonation Keywords
    let hasScamKeywords = false;
    for (const scamKw of CandidateCorrelationService.SCAM_KEYWORDS) {
      if (combinedText.includes(scamKw)) {
        hasScamKeywords = true;
        matchedRules.push(`RULE_SCAM_KEYWORD:${scamKw}`);
        riskFactors.push(`Fraudulent solicitation phrase '${scamKw}' detected in payload`);
        break;
      }
    }

    // 7. Check prior violation history in organization cases
    const priorCases = this.db.prepare(`
      SELECT COUNT(*) as count FROM cases
      WHERE organization_id = ? AND (
        contested_url = ? OR
        target_entity LIKE ?
      )
    `).get(
      signal.organization_id,
      signal.observed_url,
      `%${subject.canonical_name}%`
    ) as { count: number };

    const hasPriorHistory = (priorCases?.count || 0) > 0;
    if (hasPriorHistory) {
      matchedRules.push('RULE_PRIOR_VIOLATION_HISTORY');
      riskFactors.push('Prior enforcement history exists for entity or contested URL');
    }

    // 8. Sensitivity weight
    if (subject.sensitivity === 'critical' || subject.sensitivity === 'high') {
      riskFactors.push(`High sensitivity subject tier (${subject.sensitivity.toUpperCase()})`);
    }

    // 9. Calculate multi-factor score
    const scoreRecord = this.scoringService.calculateScore({
      signalId: signal.id,
      hasExactHandleMatch,
      hasNameAliasMatch,
      isLookalikeDomain,
      hasScamKeywords,
      hasBrandAssetAbuse: isLookalikeDomain || (hasExactHandleMatch && hasScamKeywords),
      hasPriorViolationHistory: hasPriorHistory,
      hasParodyOrSatireIndicator: hasParody,
      isOfficialDomainOrUrl: isOfficial,
      thresholdApplied: policy?.alert_threshold ?? 0.7
    });

    // Determine confidence category
    const confScore = Math.min(1.0, scoreRecord.score / 100);
    let confCategory: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (confScore >= 0.85) {
      confCategory = 'critical';
    } else if (confScore >= 0.7) {
      confCategory = 'high';
    } else if (confScore >= 0.35) {
      confCategory = 'medium';
    }

    // Determine recommended action
    const autoLinkThresh = policy?.auto_link_threshold ?? 0.85;
    const reviewThresh = policy?.human_review_threshold ?? 0.3;

    let recommendedAction:
      | 'auto_link_candidate'
      | 'queue_for_review'
      | 'quarantine_low_confidence'
      | 'dismiss_false_positive' = 'queue_for_review';

    if (isOfficial || (hasParody && confScore < 0.2)) {
      recommendedAction = 'dismiss_false_positive';
    } else if (confScore >= autoLinkThresh) {
      recommendedAction = 'auto_link_candidate';
    } else if (confScore >= reviewThresh) {
      recommendedAction = 'queue_for_review';
    } else {
      recommendedAction = 'quarantine_low_confidence';
    }

    const correlationId = `cor_${uuidv4().replace(/-/g, '')}`;
    const correlation: CandidateCorrelation = {
      id: correlationId,
      signal_id: signal.id,
      subject_id: subject.id,
      matched_rules: matchedRules,
      confidence_category: confCategory,
      confidence_score: confScore,
      risk_factors: riskFactors,
      false_positive_indicators: falsePositiveIndicators,
      recommended_action: recommendedAction,
      human_review_mandatory: 1, // ALWAYS MANDATORY
      correlated_at: new Date().toISOString()
    };

    // Persist in transaction
    const tx = this.db.transaction(() => {
      // Save score
      this.scoringService.saveScore(scoreRecord);

      // Save correlation
      this.db.prepare(`
        INSERT INTO candidate_correlations (
          id, signal_id, subject_id, matched_rules,
          confidence_category, confidence_score, risk_factors,
          false_positive_indicators, recommended_action,
          human_review_mandatory, correlated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        correlation.id,
        correlation.signal_id,
        correlation.subject_id,
        JSON.stringify(correlation.matched_rules),
        correlation.confidence_category,
        correlation.confidence_score,
        JSON.stringify(correlation.risk_factors),
        JSON.stringify(correlation.false_positive_indicators),
        correlation.recommended_action,
        correlation.human_review_mandatory,
        correlation.correlated_at
      );

      // Update signal processing status
      this.db.prepare(`
        UPDATE monitoring_signals
        SET processing_status = 'correlated', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(signal.id);
    });

    tx();

    return {
      correlation,
      scoreId: scoreRecord.id,
      riskScore: scoreRecord.score
    };
  }

  public getCorrelationBySignalId(signalId: string): CandidateCorrelation | null {
    const row = this.db.prepare(`
      SELECT * FROM candidate_correlations WHERE signal_id = ?
    `).get(signalId) as any;

    if (!row) return null;

    return {
      id: row.id,
      signal_id: row.signal_id,
      subject_id: row.subject_id,
      matched_rules: JSON.parse(row.matched_rules || '[]'),
      confidence_category: row.confidence_category,
      confidence_score: row.confidence_score,
      risk_factors: JSON.parse(row.risk_factors || '[]'),
      false_positive_indicators: JSON.parse(row.false_positive_indicators || '[]'),
      recommended_action: row.recommended_action,
      human_review_mandatory: row.human_review_mandatory,
      correlated_at: row.correlated_at
    };
  }
}
