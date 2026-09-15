import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  Case,
  CaseReadinessResult,
  MissingRequirement
} from '../domain/types.js';

export class ReadinessService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Evaluates the 14-point readiness checklist for a case
   */
  public evaluate(
    caseData: Case,
    evaluatedBy: string = 'system'
  ): CaseReadinessResult {
    const passedChecks: string[] = [];
    const missingRequirements: MissingRequirement[] = [];

    // Check 1: Title
    if (caseData.title && caseData.title.trim().length >= 5) {
      passedChecks.push('TITLE_PRESENT');
    } else {
      missingRequirements.push({
        code: 'MISSING_TITLE',
        message: 'Incident title must be at least 5 characters.',
        severity: 'blocking',
        field: 'title'
      });
    }

    // Check 2: Contested URL
    if (caseData.contested_url && /^https?:\/\//i.test(caseData.contested_url)) {
      passedChecks.push('VALID_TARGET_URL');
    } else {
      missingRequirements.push({
        code: 'INVALID_TARGET_URL',
        message: 'Valid HTTP/HTTPS contested target URL is required.',
        severity: 'blocking',
        field: 'contested_url'
      });
    }

    // Check 3: Hosting Platform
    if (caseData.hosting_platform && caseData.hosting_platform.trim().length >= 2) {
      passedChecks.push('HOSTING_PLATFORM_SPECIFIED');
    } else {
      missingRequirements.push({
        code: 'MISSING_PLATFORM',
        message: 'Hosting platform must be specified.',
        severity: 'blocking',
        field: 'hosting_platform'
      });
    }

    // Check 4: Target Entity
    if (caseData.target_entity && caseData.target_entity.trim().length >= 2) {
      passedChecks.push('TARGET_ENTITY_IDENTIFIED');
    } else {
      missingRequirements.push({
        code: 'MISSING_TARGET_ENTITY',
        message: 'Target entity/person/brand must be identified.',
        severity: 'blocking',
        field: 'target_entity'
      });
    }

    // Check 5: Reporter Contact
    if (caseData.reported_by_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(caseData.reported_by_email)) {
      passedChecks.push('REPORTER_CONTACT_PRESENT');
    } else {
      missingRequirements.push({
        code: 'INVALID_REPORTER_EMAIL',
        message: 'Valid reporter email address is required.',
        severity: 'blocking',
        field: 'reported_by_email'
      });
    }

    // Check 6: Category and Harm Type
    if (caseData.category && caseData.harm_type) {
      passedChecks.push('CATEGORY_AND_HARM_MAPPED');
    } else {
      missingRequirements.push({
        code: 'INCOMPLETE_TAXONOMY',
        message: 'Both incident category and harm type must be specified.',
        severity: 'blocking',
        field: 'category'
      });
    }

    // Check 7: Attached Available Evidence
    const evidenceItems = this.db.prepare(`
      SELECT id, safe_display_name, status, sha256, sensitivity
      FROM evidence_items
      WHERE case_id = ? AND organization_id = ?
    `).all(caseData.id, caseData.organization_id) as Array<{
      id: string;
      safe_display_name: string;
      status: string;
      sha256: string;
      sensitivity: string;
    }>;

    const availableEvidence = evidenceItems.filter((e) => e.status === 'available');
    if (availableEvidence.length > 0) {
      passedChecks.push('EVIDENCE_ATTACHED');
    } else {
      missingRequirements.push({
        code: 'NO_PRESERVED_EVIDENCE',
        message: 'At least one verified, available evidence asset must be preserved in the locker.',
        severity: 'blocking',
        field: 'evidence'
      });
    }

    // Check 8: Evidence Hashes Verified
    const unhashed = availableEvidence.filter((e) => !e.sha256 || e.sha256.length !== 64);
    if (availableEvidence.length > 0 && unhashed.length === 0) {
      passedChecks.push('EVIDENCE_HASH_VERIFIED');
    } else if (availableEvidence.length > 0) {
      missingRequirements.push({
        code: 'EVIDENCE_HASH_MISSING',
        message: 'All attached evidence assets must possess verified SHA-256 hashes.',
        severity: 'blocking',
        field: 'evidence'
      });
    }

    // Check 9: Defamation Factual Basis
    if (caseData.category === 'defamation_legal_escalation') {
      if (caseData.factual_basis && caseData.factual_basis.trim().length >= 15) {
        passedChecks.push('DEFAMATION_FACTUAL_BASIS');
      } else {
        missingRequirements.push({
          code: 'DEFAMATION_BASIS_REQUIRED',
          message: 'Defamation claims require detailed factual basis narrative (min 15 characters).',
          severity: 'blocking',
          field: 'factual_basis'
        });
      }
    } else {
      passedChecks.push('DEFAMATION_FACTUAL_BASIS');
    }

    // Check 10: Court Order Details
    if (Boolean(caseData.has_court_or_government_order)) {
      if (caseData.court_or_government_order_details && caseData.court_or_government_order_details.trim().length >= 10) {
        passedChecks.push('COURT_ORDER_DETAILS');
      } else {
        missingRequirements.push({
          code: 'COURT_ORDER_DETAILS_REQUIRED',
          message: 'Court or government order claims require order details (court name, order number, date).',
          severity: 'blocking',
          field: 'court_or_government_order_details'
        });
      }
    } else {
      passedChecks.push('COURT_ORDER_DETAILS');
    }

    // Check 11: Legal Review Sign-off
    const isLegalRequired = Boolean(caseData.requires_legal_review);
    if (isLegalRequired) {
      if (caseData.approval_status === 'legal_review_approved' || caseData.approval_status === 'ready_for_submission') {
        passedChecks.push('LEGAL_REVIEW_APPROVED');
      } else {
        missingRequirements.push({
          code: 'LEGAL_REVIEW_PENDING',
          message: 'This incident mandates formal Legal Review sign-off before submission preparation.',
          severity: 'blocking',
          field: 'approval_status'
        });
      }
    } else {
      passedChecks.push('LEGAL_REVIEW_APPROVED');
    }

    // Check 12: Reporter Declaration
    if (Boolean(caseData.declaration_confirmed)) {
      passedChecks.push('REPORTER_DECLARATION_CONFIRMED');
    } else {
      missingRequirements.push({
        code: 'DECLARATION_NOT_CONFIRMED',
        message: 'Authorized reporter truthfulness declaration must be confirmed prior to submission.',
        severity: 'blocking',
        field: 'declaration_confirmed'
      });
    }

    // Check 13: Statutory Grounds Specified
    let legalGroundsCount = 0;
    try {
      const grounds = JSON.parse(caseData.selected_legal_grounds || '[]');
      const statBasis = JSON.parse(caseData.statutory_basis || '[]');
      legalGroundsCount = grounds.length + statBasis.length;
    } catch {
      legalGroundsCount = 0;
    }

    if (legalGroundsCount > 0) {
      passedChecks.push('STATUTORY_GROUNDS_SPECIFIED');
    } else {
      missingRequirements.push({
        code: 'STATUTORY_GROUNDS_MISSING',
        message: 'At least one statutory basis or legal ground must be specified.',
        severity: 'blocking',
        field: 'selected_legal_grounds'
      });
    }

    // Check 14: No Active Quarantine Blockers
    const quarantinedItems = evidenceItems.filter((e) => e.status === 'quarantined' || e.sensitivity === 'prohibited');
    if (quarantinedItems.length > 0) {
      missingRequirements.push({
        code: 'QUARANTINED_EVIDENCE_ATTACHED',
        message: `Case references ${quarantinedItems.length} quarantined asset(s). Prohibited items must be resolved or removed before submission.`,
        severity: 'blocking',
        field: 'evidence'
      });
    } else {
      passedChecks.push('NO_BLOCKING_EVIDENCE_HOLD_OR_QUARANTINE');
    }

    const isReady = missingRequirements.filter((r) => r.severity === 'blocking').length === 0;
    const nowIso = new Date().toISOString();

    // Persist evaluation
    const evalId = uuidv4();
    this.db.prepare(`
      INSERT INTO case_readiness_evaluations (
        id, case_id, organization_id, is_ready, passed_checks,
        missing_requirements, evaluated_by, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evalId,
      caseData.id,
      caseData.organization_id,
      isReady ? 1 : 0,
      JSON.stringify(passedChecks),
      JSON.stringify(missingRequirements),
      evaluatedBy,
      nowIso
    );

    return {
      case_id: caseData.id,
      is_ready: isReady,
      passed_checks: passedChecks,
      missing_requirements: missingRequirements,
      evaluated_at: nowIso
    };
  }

  /**
   * Retrieve latest readiness evaluation for a case
   */
  public getLatestReadiness(caseId: string, organizationId: string): CaseReadinessResult | null {
    const row = this.db.prepare(`
      SELECT * FROM case_readiness_evaluations
      WHERE case_id = ? AND organization_id = ?
      ORDER BY evaluated_at DESC
      LIMIT 1
    `).get(caseId, organizationId) as any;

    if (!row) return null;

    return {
      case_id: row.case_id,
      is_ready: row.is_ready === 1,
      passed_checks: JSON.parse(row.passed_checks || '[]'),
      missing_requirements: JSON.parse(row.missing_requirements || '[]'),
      evaluated_at: row.evaluated_at
    };
  }
}
