import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  Case,
  CaseTriageRecord,
  IncidentIntakeInput,
  TriageClassification
} from '../domain/types.js';

export interface TriageEvaluation {
  classification: TriageClassification;
  confidence: 'high' | 'medium' | 'low';
  triggeredRules: string[];
  requiresHumanReview: boolean;
  requiresLegalReview: boolean;
  notes: string;
}

export class TriageService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Deterministic, rule-based triage evaluation for an incident
   */
  public evaluate(input: Partial<IncidentIntakeInput> | Partial<Case>): TriageEvaluation {
    const category = input.category;
    const syntheticMedia = input.suspected_synthetic_media_type;
    const harmType = input.harm_type;
    const involvesIntimate = Boolean(input.involves_intimate_imagery);
    const hasCourtOrder = Boolean(input.has_court_or_government_order);

    const triggeredRules: string[] = [];

    // Rule 1: Intimate imagery (CSAM/NCII / IT Rules 2021 Rule 3(2)(b))
    if (involvesIntimate) {
      triggeredRules.push('INTIMATE_IMAGERY_RULE_3_2_B', 'STATUTORY_EXPEDITED_24H');
      return {
        classification: 'non_consensual_intimate_imagery',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: true,
        notes: 'Critical: Potential intimate or likeness abuse under IT Rules 2021 Rule 3(2)(b) requires 24-hour statutory takedown and mandatory legal sign-off.'
      };
    }

    // Rule 2: Defamation or legal escalation
    if (category === 'defamation_legal_escalation') {
      triggeredRules.push('DEFAMATION_SUBSTANTIATION_REQUIRED', 'MANDATORY_LEGAL_REVIEW');
      return {
        classification: 'defamation_or_legal_escalation',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: true,
        notes: 'Defamation complaint requires verified factual basis narrative and mandatory legal sign-off before submission.'
      };
    }

    // Rule 3: High-risk synthetic media (audio clone, face swap, lip sync deepfake, multimodal)
    if (
      category === 'synthetic_media_endorsement' ||
      (syntheticMedia && ['audio_clone', 'face_swap_video', 'lip_sync_deepfake', 'multimodal_composite'].includes(syntheticMedia))
    ) {
      triggeredRules.push('SYNTHETIC_MEDIA_DEEPFAKE_FLAG', 'HIGH_RISK_LIPSYNC_FACESWAP');
      return {
        classification: 'synthetic_media_impersonation',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: true,
        notes: 'Synthetic media deepfake impersonation identified. Technical evidence analysis and chain of custody preservation required.'
      };
    }

    // Rule 4: Privacy or likeness complaint
    if (category === 'privacy_or_likeness_complaint' || harmType === 'privacy_violation') {
      triggeredRules.push('PRIVACY_LIKENESS_MISUSE', 'IT_RULES_2021_RULE_3_2_B');
      return {
        classification: 'privacy_or_likeness_complaint',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: true,
        notes: 'Likeness and privacy infringement under Rule 3(2)(b). 24h statutory clock applies for individual persona.'
      };
    }

    // Rule 5: Copyright or trademark complaint
    if (category === 'copyright_trademark_misuse' || harmType === 'trademark_infringement') {
      triggeredRules.push('IPR_TRADEMARK_COPYRIGHT_POLICY', 'DMCA_IT_RULES_INTERMEDIARY');
      return {
        classification: 'copyright_or_trademark_complaint',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: true,
        notes: 'Intellectual property infringement requires verified trademark/copyright registration and authorized representative status.'
      };
    }

    // Rule 6: Financial fraud / extortion / fake commercial endorsement
    if (harmType === 'financial_fraud' || harmType === 'extortion') {
      triggeredRules.push('FINANCIAL_FRAUD_HARMFUL_ACTIVITY', 'BNS_318_4_CHEATING_BY_PERSONATION');
      if (hasCourtOrder) {
        triggeredRules.push('COURT_OR_GOV_ORDER_PRIORITY');
      }
      return {
        classification: 'fake_endorsement_or_commercial_misuse',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: false,
        notes: 'Financial fraud or extortion elements detected under BNS 318(4) cheating by personation.'
      };
    }

    // Rule 7: Standard impersonation profiles
    if (
      category === 'fake_social_profile' ||
      category === 'brand_impersonation' ||
      category === 'founder_doctor_creator_impersonation' ||
      category === 'fake_support_account' ||
      category === 'look_alike_domain' ||
      category === 'scam_advertisement'
    ) {
      triggeredRules.push('STANDARD_IMPERSONATION_RULE_3_1_B');
      if (hasCourtOrder) {
        triggeredRules.push('COURT_OR_GOV_ORDER_PRIORITY');
      }
      return {
        classification: 'standard_impersonation',
        confidence: 'high',
        triggeredRules,
        requiresHumanReview: true,
        requiresLegalReview: false,
        notes: 'Standard impersonation profile under IT Rules 2021 Rule 3(1)(b). 72h general takedown timeframe.'
      };
    }

    // Fallback: Ambiguous / unknown
    triggeredRules.push('AMBIGUOUS_FACTORS_FALLBACK');
    return {
      classification: 'unknown_needs_human_review',
      confidence: 'low',
      triggeredRules,
      requiresHumanReview: true,
      requiresLegalReview: true,
      notes: 'Ambiguous incident profile requires comprehensive manual operator and legal review.'
    };
  }

  /**
   * Evaluates and persists a triage record for a case
   */
  public recordTriage(
    caseId: string,
    organizationId: string,
    actorOrComponent: string,
    caseData: Partial<IncidentIntakeInput> | Partial<Case>,
    customNotes?: string
  ): CaseTriageRecord {
    const evaluation = this.evaluate(caseData);
    const id = uuidv4();
    const notes = customNotes ? `${evaluation.notes} Note: ${customNotes}` : evaluation.notes;

    this.db.prepare(`
      INSERT INTO case_triage_records (
        id, case_id, organization_id, classification, confidence,
        triggered_rules, actor_or_component, requires_human_review, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      caseId,
      organizationId,
      evaluation.classification,
      evaluation.confidence,
      JSON.stringify(evaluation.triggeredRules),
      actorOrComponent,
      evaluation.requiresHumanReview ? 1 : 0,
      notes
    );

    return {
      id,
      case_id: caseId,
      organization_id: organizationId,
      classification: evaluation.classification,
      confidence: evaluation.confidence,
      triggered_rules: evaluation.triggeredRules,
      actor_or_component: actorOrComponent,
      requires_human_review: evaluation.requiresHumanReview ? 1 : 0,
      notes,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Retrieves latest triage record for a case
   */
  public getLatestTriage(caseId: string, organizationId: string): CaseTriageRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM case_triage_records
      WHERE case_id = ? AND organization_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(caseId, organizationId) as any;

    if (!row) return null;

    return {
      id: row.id,
      case_id: row.case_id,
      organization_id: row.organization_id,
      classification: row.classification,
      confidence: row.confidence,
      triggered_rules: JSON.parse(row.triggered_rules || '[]'),
      actor_or_component: row.actor_or_component,
      requires_human_review: row.requires_human_review,
      notes: row.notes,
      created_at: row.created_at
    };
  }
}
