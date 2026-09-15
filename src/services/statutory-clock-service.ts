import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  ClockEvaluation,
  ClockStatus,
  IncidentIntakeInput,
  StatutoryClock,
  Case
} from '../domain/types.js';

export class StatutoryClockService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Initializes statutory clocks for a newly intake case
   */
  public initializeClock(
    caseId: string,
    organizationId: string,
    data: Partial<IncidentIntakeInput> | Partial<Case>,
    nowDate: Date = new Date()
  ): StatutoryClock {
    const discoveredAt = data.discovered_at || nowDate.toISOString();
    const complaintCreatedAt = nowDate.toISOString();

    const createdAtEpoch = nowDate.getTime();

    // Acknowledgement deadline is always 24 hours under IT Rules 2021 Rule 3(2)(a)
    const acknowledgementDeadline = new Date(createdAtEpoch + 24 * 60 * 60 * 1000).toISOString();

    // Escalation deadline (e.g. GAC appeal or formal statutory escalation) is 15 calendar days
    const escalationDeadline = new Date(createdAtEpoch + 15 * 24 * 60 * 60 * 1000).toISOString();

    // Submission / Takedown window:
    // Rule 3(2)(b): 24h for intimate imagery or individual likeness impersonation
    // Rule 3(1)(b): 72h for general impersonation / misinformation
    const is24hCategory =
      Boolean(data.involves_intimate_imagery) ||
      data.category === 'privacy_or_likeness_complaint' ||
      data.harm_type === 'privacy_violation' ||
      data.category === 'synthetic_media_endorsement';

    const hasCourtOrder = Boolean(data.has_court_or_government_order);

    let submissionHours = 72;
    let operationalBasis = 'IT Rules 2021 Rule 3(1)(b) - 72h Intermediary Due Diligence Window';
    let operationalRule = 'IT_RULES_2021_RULE_3_1_B';
    let sourceCitation = 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 Rule 3(1)(b)';

    if (is24hCategory) {
      submissionHours = 24;
      operationalBasis = 'IT Rules 2021 Rule 3(2)(b) - Expedited 24h Intimate/Likeness Impersonation Window';
      operationalRule = 'IT_RULES_2021_RULE_3_2_B';
      sourceCitation = 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 Rule 3(2)(b)';
    } else if (hasCourtOrder) {
      submissionHours = 24;
      operationalBasis = 'Judicial/Government Order Enforcement - Priority 24h Expedited Window';
      operationalRule = 'JUDICIAL_GOVERNMENT_DIRECTIVE';
      sourceCitation = 'IT Rules 2021 Rule 3(1)(d) read with Section 79(3)(b) Information Technology Act, 2000';
    }

    const submissionDeadline = new Date(createdAtEpoch + submissionHours * 60 * 60 * 1000).toISOString();

    const id = uuidv4();
    const courtOrderEvidence = data.court_or_government_order_details || null;
    const jurisdiction = 'IN-National';
    const sourceUrlOrId = 'https://www.meity.gov.in/writereaddata/files/Intermediary_Guidelines_and_Digital_Media_Ethics_Code_Rules-2021.pdf';
    const effectiveDate = '2021-02-25';
    const lastVerifiedDate = '2026-09-01';
    const deadlineType = 'legally_mandatory' as const;

    this.db.prepare(`
      INSERT INTO statutory_clocks (
        id, case_id, organization_id, incident_discovered_at, complaint_created_at,
        acknowledgement_deadline, submission_deadline, escalation_deadline,
        current_status, operational_basis, source_note, timezone, court_order_evidence,
        operational_rule, jurisdiction, source_citation, source_url_or_identifier,
        effective_date, last_verified_date, deadline_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, 'Asia/Kolkata', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      caseId,
      organizationId,
      discoveredAt,
      complaintCreatedAt,
      acknowledgementDeadline,
      submissionDeadline,
      escalationDeadline,
      operationalBasis,
      data.operator_notes || null,
      courtOrderEvidence,
      operationalRule,
      jurisdiction,
      sourceCitation,
      sourceUrlOrId,
      effectiveDate,
      lastVerifiedDate,
      deadlineType
    );

    return {
      id,
      case_id: caseId,
      organization_id: organizationId,
      incident_discovered_at: discoveredAt,
      complaint_created_at: complaintCreatedAt,
      acknowledgement_deadline: acknowledgementDeadline,
      submission_deadline: submissionDeadline,
      escalation_deadline: escalationDeadline,
      current_status: 'running',
      operational_basis: operationalBasis,
      source_note: data.operator_notes || null,
      timezone: 'Asia/Kolkata',
      court_order_evidence: courtOrderEvidence,
      operational_rule: operationalRule,
      jurisdiction,
      source_citation: sourceCitation,
      source_url_or_identifier: sourceUrlOrId,
      effective_date: effectiveDate,
      last_verified_date: lastVerifiedDate,
      deadline_type: deadlineType,
      created_at: complaintCreatedAt,
      updated_at: complaintCreatedAt
    };
  }

  /**
   * Evaluates the active status and remaining time for a statutory clock
   */
  public evaluateClock(clock: StatutoryClock, now: Date = new Date()): ClockEvaluation {
    const nowEpoch = now.getTime();
    const ackEpoch = new Date(clock.acknowledgement_deadline).getTime();
    const subEpoch = new Date(clock.submission_deadline).getTime();
    const escEpoch = new Date(clock.escalation_deadline).getTime();

    const acknowledgementRemainingHours = Number(((ackEpoch - nowEpoch) / (1000 * 60 * 60)).toFixed(2));
    const submissionRemainingHours = Number(((subEpoch - nowEpoch) / (1000 * 60 * 60)).toFixed(2));
    const escalationRemainingHours = Number(((escEpoch - nowEpoch) / (1000 * 60 * 60)).toFixed(2));

    const warnings: string[] = [];
    const isOverdue = submissionRemainingHours <= 0;
    const isUrgent = submissionRemainingHours > 0 && submissionRemainingHours <= 3;
    const isDueSoon = submissionRemainingHours > 0 && submissionRemainingHours <= 24;

    if (isOverdue) {
      warnings.push(`Statutory submission deadline exceeded by ${Math.abs(submissionRemainingHours)} hours.`);
    } else if (isUrgent) {
      warnings.push(`CRITICAL: Statutory submission deadline expires in ${submissionRemainingHours} hours!`);
    } else if (isDueSoon) {
      warnings.push(`Statutory submission deadline is due within 24 hours (${submissionRemainingHours}h remaining).`);
    }

    if (acknowledgementRemainingHours <= 0 && clock.current_status === 'running') {
      warnings.push('Rule 3(2)(a) 24h complaint acknowledgement window has lapsed.');
    }

    let currentStatus = clock.current_status;
    if (clock.current_status === 'running') {
      if (isOverdue) {
        currentStatus = 'overdue';
      } else if (isDueSoon) {
        currentStatus = 'due_soon';
      }
    }

    return {
      clock: {
        ...clock,
        current_status: currentStatus
      },
      acknowledgement_remaining_hours: acknowledgementRemainingHours,
      submission_remaining_hours: submissionRemainingHours,
      escalation_remaining_hours: escalationRemainingHours,
      is_due_soon: isDueSoon,
      is_urgent: isUrgent,
      is_overdue: isOverdue,
      warnings,
      operational_rule: clock.operational_rule,
      jurisdiction: clock.jurisdiction,
      source_citation: clock.source_citation,
      deadline_type: clock.deadline_type
    };
  }

  /**
   * Fetch statutory clock for a given case
   */
  public getClockForCase(caseId: string, organizationId: string): StatutoryClock | null {
    const row = this.db.prepare(`
      SELECT * FROM statutory_clocks
      WHERE case_id = ? AND organization_id = ?
    `).get(caseId, organizationId) as any;

    if (!row) return null;

    return {
      id: row.id,
      case_id: row.case_id,
      organization_id: row.organization_id,
      incident_discovered_at: row.incident_discovered_at,
      complaint_created_at: row.complaint_created_at,
      acknowledgement_deadline: row.acknowledgement_deadline,
      submission_deadline: row.submission_deadline,
      escalation_deadline: row.escalation_deadline,
      current_status: row.current_status,
      paused_reason: row.paused_reason,
      operational_basis: row.operational_basis,
      source_note: row.source_note,
      timezone: row.timezone,
      court_order_evidence: row.court_order_evidence,
      operational_rule: row.operational_rule || 'IT_RULES_2021_RULE_3_2_B',
      jurisdiction: row.jurisdiction || 'IN-National',
      source_citation: row.source_citation || 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021',
      source_url_or_identifier: row.source_url_or_identifier || 'https://www.meity.gov.in/writereaddata/files/Intermediary_Guidelines_and_Digital_Media_Ethics_Code_Rules-2021.pdf',
      effective_date: row.effective_date || '2021-02-25',
      last_verified_date: row.last_verified_date || '2026-09-01',
      deadline_type: row.deadline_type || 'legally_mandatory',
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Updates statutory clock status
   */
  public updateClockStatus(
    caseId: string,
    organizationId: string,
    status: ClockStatus,
    pausedReason?: string
  ): StatutoryClock {
    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE statutory_clocks
      SET current_status = ?, paused_reason = ?, updated_at = ?
      WHERE case_id = ? AND organization_id = ?
    `).run(status, pausedReason || null, nowIso, caseId, organizationId);

    const updated = this.getClockForCase(caseId, organizationId);
    if (!updated) {
      throw new Error(`Statutory clock for case ${caseId} not found`);
    }
    return updated;
  }
}
