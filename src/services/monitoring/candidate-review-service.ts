import Database from 'better-sqlite3';
import { getDatabase } from '../../db/connection.js';
import {
  CandidateReview,
  CandidateReviewStatus,
  ReviewCandidateInput,
  Role,
  Priority
} from '../../domain/types.js';
import { CaseService } from '../case-service.js';
import { SignalCaseLinkService } from './signal-case-link-service.js';
import { AuditService } from '../audit-service.js';
import { NotificationService } from '../notification-service.js';

export interface CandidateReviewQueueItem {
  review: CandidateReview;
  signal: {
    id: string;
    observed_url: string;
    normalized_url: string;
    platform: string;
    content_type: string;
    observed_at: string;
    adapter_name: string;
    source_type: string;
  };
  subject: {
    id: string;
    canonical_name: string;
    subject_type: string;
    sensitivity: string;
    authorization_reference: string;
  };
  correlation?: {
    confidence_category: string;
    confidence_score: number;
    matched_rules: string[];
    risk_factors: string[];
    false_positive_indicators: string[];
    recommended_action: string;
    human_review_mandatory: number;
  } | null;
  risk_score?: {
    score: number;
    threshold_applied: number;
    disclaimer: string;
    factors: any;
  } | null;
  duplicate_url_warning?: {
    hasDuplicate: boolean;
    duplicateCaseId?: string;
    duplicateCaseNumber?: string;
  };
}

export class CandidateReviewService {
  private db: Database.Database;
  private caseService: CaseService;
  private linkService: SignalCaseLinkService;
  private auditService: AuditService;
  private notificationService: NotificationService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.caseService = new CaseService(this.db);
    this.linkService = new SignalCaseLinkService(this.db);
    this.auditService = new AuditService(this.db);
    this.notificationService = new NotificationService(this.db);
  }

  /**
   * Retrieves the queue of candidates requiring human review
   */
  public listReviewQueue(
    organizationId: string,
    filters?: {
      status?: CandidateReviewStatus;
      priority?: Priority;
      subjectId?: string;
      limit?: number;
      offset?: number;
    }
  ): CandidateReviewQueueItem[] {
    let sql = `
      SELECT 
        r.id as r_id, r.signal_id as r_signal_id, r.organization_id as r_organization_id,
        r.status as r_status, r.priority as r_priority, r.analyst_decision as r_analyst_decision,
        r.decision_reason as r_decision_reason, r.false_positive_category as r_false_positive_category,
        r.reviewed_by_user_id as r_reviewed_by_user_id, r.reviewed_at as r_reviewed_at,
        r.case_id as r_case_id, r.created_at as r_created_at, r.updated_at as r_updated_at,
        
        s.id as s_id, s.observed_url as s_observed_url, s.normalized_url as s_normalized_url,
        s.platform as s_platform, s.content_type as s_content_type, s.observed_at as s_observed_at,
        s.adapter_name as s_adapter_name, s.source_type as s_source_type,
        
        sub.id as sub_id, sub.canonical_name as sub_canonical_name, sub.subject_type as sub_subject_type,
        sub.sensitivity as sub_sensitivity, sub.authorization_reference as sub_auth_ref,
        
        cor.confidence_category as cor_category, cor.confidence_score as cor_score,
        cor.matched_rules as cor_rules, cor.risk_factors as cor_factors,
        cor.false_positive_indicators as cor_fp_indicators, cor.recommended_action as cor_action,
        cor.human_review_mandatory as cor_mandatory,
        
        scr.score as scr_score, scr.threshold_applied as scr_threshold,
        scr.disclaimer as scr_disclaimer, scr.factors as scr_factors

      FROM candidate_reviews r
      JOIN monitoring_signals s ON r.signal_id = s.id
      JOIN monitored_subjects sub ON s.subject_id = sub.id
      LEFT JOIN candidate_correlations cor ON s.id = cor.signal_id
      LEFT JOIN candidate_risk_scores scr ON s.id = scr.signal_id
      WHERE r.organization_id = ?
    `;

    const params: any[] = [organizationId];

    if (filters?.status) {
      sql += ` AND r.status = ?`;
      params.push(filters.status);
    }
    if (filters?.priority) {
      sql += ` AND r.priority = ?`;
      params.push(filters.priority);
    }
    if (filters?.subjectId) {
      sql += ` AND s.subject_id = ?`;
      params.push(filters.subjectId);
    }

    sql += ` ORDER BY 
      CASE r.priority 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END ASC,
      r.created_at DESC
      LIMIT ? OFFSET ?
    `;

    params.push(filters?.limit ?? 50);
    params.push(filters?.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((r) => {
      const duplicateCheck = this.linkService.checkForDuplicateUrl(
        organizationId,
        r.s_normalized_url
      );

      return {
        review: {
          id: r.r_id,
          signal_id: r.r_signal_id,
          organization_id: r.r_organization_id,
          status: r.r_status,
          priority: r.r_priority,
          analyst_decision: r.r_analyst_decision,
          decision_reason: r.r_decision_reason,
          false_positive_category: r.r_false_positive_category,
          reviewed_by_user_id: r.r_reviewed_by_user_id,
          reviewed_at: r.r_reviewed_at,
          case_id: r.r_case_id,
          created_at: r.r_created_at,
          updated_at: r.r_updated_at
        },
        signal: {
          id: r.s_id,
          observed_url: r.s_observed_url,
          normalized_url: r.s_normalized_url,
          platform: r.s_platform,
          content_type: r.s_content_type,
          observed_at: r.s_observed_at,
          adapter_name: r.s_adapter_name,
          source_type: r.s_source_type
        },
        subject: {
          id: r.sub_id,
          canonical_name: r.sub_canonical_name,
          subject_type: r.sub_subject_type,
          sensitivity: r.sub_sensitivity,
          authorization_reference: r.sub_auth_ref
        },
        correlation: r.cor_score !== null && r.cor_score !== undefined
          ? {
              confidence_category: r.cor_category,
              confidence_score: r.cor_score,
              matched_rules: JSON.parse(r.cor_rules || '[]'),
              risk_factors: JSON.parse(r.cor_factors || '[]'),
              false_positive_indicators: JSON.parse(r.cor_fp_indicators || '[]'),
              recommended_action: r.cor_action,
              human_review_mandatory: r.cor_mandatory !== null && r.cor_mandatory !== undefined ? r.cor_mandatory : 1
            }
          : null,
        risk_score: r.scr_score !== null && r.scr_score !== undefined
          ? {
              score: r.scr_score,
              threshold_applied: r.scr_threshold,
              disclaimer: r.scr_disclaimer,
              factors: JSON.parse(r.scr_factors || '{}')
            }
          : null,
        duplicate_url_warning: duplicateCheck.hasDuplicate
          ? {
              hasDuplicate: true,
              duplicateCaseId: duplicateCheck.duplicateCaseId,
              duplicateCaseNumber: duplicateCheck.duplicateCaseNumber
            }
          : { hasDuplicate: false }
      };
    });
  }

  /**
   * Processes an analyst review decision on a candidate signal
   */
  public reviewCandidate(
    organizationId: string,
    reviewId: string,
    actorUserId: string,
    actorRole: Role,
    input: ReviewCandidateInput
  ): CandidateReview {
    const row = this.db.prepare(`
      SELECT r.*, s.id as signal_id, s.observed_url, s.normalized_url, s.platform,
             s.subject_id, sub.canonical_name
      FROM candidate_reviews r
      JOIN monitoring_signals s ON r.signal_id = s.id
      JOIN monitored_subjects sub ON s.subject_id = sub.id
      WHERE r.id = ? AND r.organization_id = ?
    `).get(reviewId, organizationId) as any;

    if (!row) {
      throw new Error(`NOT_FOUND: Candidate review ${reviewId} not found`);
    }

    const now = new Date().toISOString();
    let targetCaseId: string | null = row.case_id || null;
    let targetStatus: CandidateReviewStatus = 'pending';

    if (input.decision === 'confirm_candidate') {
      targetStatus = 'confirmed';

      // 1. Spawning a new case
      if (input.create_new_case) {
        const newCase = this.caseService.createCase(
          organizationId,
          {
            title: input.case_title || `Suspected Impersonation: ${row.canonical_name}`,
            category: input.case_category || 'brand_impersonation',
            priority: input.priority || row.priority || 'medium',
            target_entity: row.canonical_name,
            contested_url: row.observed_url,
            hosting_platform: row.platform,
            reported_by_email: 'analyst-review@desk.internal',
            statutory_basis: []
          },
          {
            user_id: actorUserId,
            email: 'analyst@desk.internal',
            role: actorRole
          }
        );

        targetCaseId = newCase.id;

        // Link signal to the newly created case
        this.linkService.linkSignalToCase({
          signalId: row.signal_id,
          caseId: newCase.id,
          linkType: 'evidence',
          actorUserId,
          organizationId
        });

        // Notify case assignment / creation
        try {
          this.notificationService.queueNotification({
            organization_id: organizationId,
            user_id: actorUserId,
            title: `CASE SPAWNED: ${newCase.case_number}`,
            body: `Candidate confirmed for ${row.canonical_name}. Case ${newCase.case_number} created and evidence linked.`,
            notification_type: 'case_assigned',
            idempotency_key: `notif_case_spawn_${newCase.id}`,
            delivery_channel: 'in_app'
          });
        } catch {
          // Ignore notification duplicate key errors
        }
      } else if (input.link_to_existing_case_id) {
        // 2. Linking to an existing case
        targetCaseId = input.link_to_existing_case_id;
        this.linkService.linkSignalToCase({
          signalId: row.signal_id,
          caseId: targetCaseId,
          linkType: 'evidence',
          actorUserId,
          organizationId
        });
      }
    } else if (
      input.decision === 'dismiss_benign' ||
      input.decision === 'dismiss_parody' ||
      input.decision === 'dismiss_authorized' ||
      input.decision === 'dismiss_unrelated'
    ) {
      targetStatus = 'dismissed';
    } else if (input.decision === 'quarantine_insufficient_evidence') {
      targetStatus = 'quarantined';
    }

    const tx = this.db.transaction(() => {
      // Update review record
      this.db.prepare(`
        UPDATE candidate_reviews SET
          status = ?,
          analyst_decision = ?,
          decision_reason = ?,
          false_positive_category = ?,
          priority = ?,
          reviewed_by_user_id = ?,
          reviewed_at = ?,
          case_id = ?,
          updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).run(
        targetStatus,
        input.decision,
        input.decision_reason,
        input.false_positive_category || null,
        input.priority || row.priority,
        actorUserId,
        now,
        targetCaseId,
        now,
        reviewId,
        organizationId
      );

      // Update signal processing status
      this.db.prepare(`
        UPDATE monitoring_signals SET
          processing_status = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        targetStatus === 'quarantined' ? 'quarantined' : 'reviewed',
        now,
        row.signal_id
      );
    });

    tx();

    this.auditService.record({
      action: 'candidate_reviewed',
      resource_type: 'candidate_review',
      resource_id: reviewId,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'analyst@desk.internal',
      details: {
        decision: input.decision,
        target_status: targetStatus,
        case_id: targetCaseId,
        false_positive_category: input.false_positive_category
      }
    });

    return {
      id: reviewId,
      signal_id: row.signal_id,
      organization_id: organizationId,
      status: targetStatus,
      priority: input.priority || row.priority,
      analyst_decision: input.decision,
      decision_reason: input.decision_reason,
      false_positive_category: input.false_positive_category || null,
      reviewed_by_user_id: actorUserId,
      reviewed_at: now,
      case_id: targetCaseId,
      created_at: row.created_at,
      updated_at: now
    };
  }
}
