import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  ApprovalState,
  Case,
  CaseApprovalRecord,
  CaseNote,
  CaseStatus,
  CaseStatusHistory,
  CATEGORIES_REQUIRING_LEGAL_REVIEW,
  CreateCaseInput,
  CreateCaseNoteInput,
  IncidentIntakeInput,
  Role,
  TransitionCaseStatusInput
} from '../domain/types.js';
import { validateStateTransition } from '../domain/state-machine.js';
import { validateApprovalTransition } from '../domain/approval-state-machine.js';
import { AuditService } from './audit-service.js';
import { TriageService } from './triage-service.js';
import { StatutoryClockService } from './statutory-clock-service.js';
import { ReadinessService } from './readiness-service.js';
import { SubmissionPacketService } from './submission-packet-service.js';
import { WorkflowTaskService } from './workflow-task-service.js';
import { DuplicateDetectionService } from './duplicate-detection-service.js';

export interface ActorContext {
  user_id: string;
  email: string;
  role: Role;
  ip_address?: string;
  user_agent?: string;
  correlation_id?: string;
}

export interface CaseFilterOptions {
  status?: CaseStatus;
  approval_status?: ApprovalState;
  category?: string;
  priority?: string;
  assigned_to_user_id?: string;
  search?: string;
}

export class CaseService {
  private auditService: AuditService;
  public triageService: TriageService;
  public statutoryClockService: StatutoryClockService;
  public readinessService: ReadinessService;
  public submissionPacketService: SubmissionPacketService;
  public workflowTaskService: WorkflowTaskService;
  public duplicateDetectionService: DuplicateDetectionService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
    this.triageService = new TriageService(this.db);
    this.statutoryClockService = new StatutoryClockService(this.db);
    this.readinessService = new ReadinessService(this.db);
    this.submissionPacketService = new SubmissionPacketService(this.db);
    this.workflowTaskService = new WorkflowTaskService(this.db);
    this.duplicateDetectionService = new DuplicateDetectionService(this.db);
  }

  /**
   * Generates a unique sequential case number for the organization (e.g. CS-2026-001)
   */
  private generateCaseNumber(organization_id: string): string {
    const year = new Date().getFullYear();
    const countRow = this.db
      .prepare('SELECT COUNT(*) as count FROM cases WHERE organization_id = ?')
      .get(organization_id) as { count: number };
    const nextSeq = (countRow.count + 1).toString().padStart(3, '0');
    return `CS-${year}-${nextSeq}`;
  }

  /**
   * Creates a new case within the tenant organization (supporting both legacy Phase 1 and extended Phase 3 intake)
   */
  public createCase(
    organization_id: string,
    input: CreateCaseInput | IncidentIntakeInput,
    actor: ActorContext
  ): Case {
    const id = `case_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const caseNumber = this.generateCaseNumber(organization_id);

    // Normalize contested URL
    const normalizedUrl = this.duplicateDetectionService.normalizeUrl(input.contested_url);

    // Rule-based triage evaluation
    const triageEval = this.triageService.evaluate(input);

    // Determine legal review requirement
    const isLegalRequired =
      CATEGORIES_REQUIRING_LEGAL_REVIEW.includes(input.category) ||
      triageEval.requiresLegalReview ||
      Boolean((input as any).involves_intimate_imagery)
        ? 1
        : 0;

    const statutoryBasisJson = JSON.stringify(input.statutory_basis || []);
    const selectedGroundsJson = JSON.stringify((input as any).selected_legal_grounds || []);

    const targetEntityType = (input as any).target_entity_type || 'individual_professional';
    const affectedJurisdiction = (input as any).affected_jurisdiction || 'IN-National';
    const urgency = (input as any).urgency || 'medium';
    const syntheticMediaType = (input as any).suspected_synthetic_media_type || 'none';
    const impersonationMethod = (input as any).impersonation_method || 'profile_cloning';
    const harmType = (input as any).harm_type || 'reputational';
    const involvesIntimate = (input as any).involves_intimate_imagery ? 1 : 0;
    const hasCourtOrder = (input as any).has_court_or_government_order ? 1 : 0;
    const courtOrderDetails = (input as any).court_or_government_order_details || null;
    const discoveredAt = (input as any).discovered_at || now;
    const reportedByName = (input as any).reported_by_name || null;
    const factualBasis = (input as any).factual_basis || null;
    const operatorNotes = (input as any).operator_notes || null;
    const declarationConfirmed = (input as any).declaration_confirmed ? 1 : 0;
    const declaredAt = declarationConfirmed ? now : null;

    const stmt = this.db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis,
        target_entity_type, affected_jurisdiction, urgency, suspected_synthetic_media_type,
        impersonation_method, harm_type, involves_intimate_imagery, has_court_or_government_order,
        court_or_government_order_details, discovered_at, reported_by_name, factual_basis,
        operator_notes, approval_status, selected_legal_grounds, declaration_confirmed,
        declared_at, normalized_contested_url, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 'new',
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, 'draft', ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      id,
      organization_id,
      caseNumber,
      input.title,
      input.category,
      input.priority || 'medium',
      input.target_entity,
      input.contested_url,
      input.hosting_platform,
      input.reported_by_email,
      input.assigned_to_user_id || null,
      isLegalRequired,
      statutoryBasisJson,
      targetEntityType,
      affectedJurisdiction,
      urgency,
      syntheticMediaType,
      impersonationMethod,
      harmType,
      involvesIntimate,
      hasCourtOrder,
      courtOrderDetails,
      discoveredAt,
      reportedByName,
      factualBasis,
      operatorNotes,
      selectedGroundsJson,
      declarationConfirmed,
      declaredAt,
      normalizedUrl,
      now,
      now
    );

    // Persist triage record
    this.triageService.recordTriage(
      id,
      organization_id,
      actor.user_id,
      input,
      'Automated initial intake triage evaluation.'
    );

    // Initialize statutory clocks
    this.statutoryClockService.initializeClock(id, organization_id, input, new Date(now));

    // Detect duplicate incidents within organization
    this.duplicateDetectionService.detectDuplicates(id, organization_id, input.contested_url);

    // If legal review required, create task
    if (isLegalRequired) {
      this.workflowTaskService.createTask({
        caseId: id,
        organizationId: organization_id,
        taskType: 'legal_review_required',
        priority: 'p1',
        assignedRole: 'legal_reviewer',
        creationReason: `Mandatory legal review required for category '${input.category}' before submission preparation.`
      });
    }

    // Record creation audit event
    this.auditService.record({
      organization_id,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'case.created',
      resource_type: 'case',
      resource_id: id,
      details: {
        case_number: caseNumber,
        title: input.title,
        category: input.category,
        priority: input.priority,
        contested_url: input.contested_url,
        triage_classification: triageEval.classification
      },
      ip_address: actor.ip_address
    });

    return this.getCaseById(organization_id, id)!;
  }

  /**
   * Retrieves cases for an organization with optional filtering
   */
  public getCases(organization_id: string, filters: CaseFilterOptions = {}): Case[] {
    let sql = 'SELECT * FROM cases WHERE organization_id = ?';
    const params: any[] = [organization_id];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.approval_status) {
      sql += ' AND approval_status = ?';
      params.push(filters.approval_status);
    }
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.priority) {
      sql += ' AND priority = ?';
      params.push(filters.priority);
    }
    if (filters.assigned_to_user_id) {
      sql += ' AND assigned_to_user_id = ?';
      params.push(filters.assigned_to_user_id);
    }
    if (filters.search) {
      sql += ' AND (title LIKE ? OR target_entity LIKE ? OR contested_url LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY created_at DESC';

    return this.db.prepare(sql).all(...params) as Case[];
  }

  /**
   * Retrieves single case by ID strictly scoped to tenant organization
   */
  public getCaseById(organization_id: string, case_id: string): Case | null {
    const stmt = this.db.prepare('SELECT * FROM cases WHERE organization_id = ? AND id = ?');
    const row = stmt.get(organization_id, case_id) as Case | undefined;
    return row || null;
  }

  /**
   * Transitions a case status through the deterministic state machine
   */
  public transitionStatus(
    organization_id: string,
    case_id: string,
    input: TransitionCaseStatusInput,
    actor: ActorContext
  ): Case {
    const existingCase = this.getCaseById(organization_id, case_id);
    if (!existingCase) {
      throw new Error(`Case '${case_id}' not found in organization.`);
    }

    // Validate transition via state machine rules
    validateStateTransition({
      fromStatus: existingCase.status,
      toStatus: input.to_status,
      userRole: actor.role,
      category: existingCase.category,
      requiresLegalReview: existingCase.requires_legal_review === 1
    });

    const now = new Date().toISOString();
    const historyId = `hist_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const transaction = this.db.transaction(() => {
      // 1. Update case status and updated_at
      this.db
        .prepare('UPDATE cases SET status = ?, updated_at = ? WHERE organization_id = ? AND id = ?')
        .run(input.to_status, now, organization_id, case_id);

      // 2. Record status history entry
      this.db
        .prepare(`
          INSERT INTO case_status_history (
            id, case_id, organization_id, from_status, to_status,
            actor_user_id, actor_email, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          historyId,
          case_id,
          organization_id,
          existingCase.status,
          input.to_status,
          actor.user_id,
          actor.email,
          input.reason,
          now
        );

      // 3. Record audit event
      this.auditService.record({
        organization_id,
        actor_user_id: actor.user_id,
        actor_email: actor.email,
        action: 'case.status_changed',
        resource_type: 'case',
        resource_id: case_id,
        details: {
          previous_status: existingCase.status,
          new_status: input.to_status,
          reason: input.reason
        },
        ip_address: actor.ip_address
      });
    });

    transaction();

    return this.getCaseById(organization_id, case_id)!;
  }

  /**
   * Transitions Phase 3 case approval state with separation of duties and gate checks
   */
  public transitionApprovalState(
    organization_id: string,
    case_id: string,
    toState: ApprovalState,
    reason: string,
    actor: ActorContext,
    approvalType: string = 'workflow_gate',
    requesterUserId?: string | null
  ): Case {
    const existingCase = this.getCaseById(organization_id, case_id);
    if (!existingCase) {
      throw new Error(`Case '${case_id}' not found in organization.`);
    }

    const currentApprovalState = (existingCase.approval_status as ApprovalState) || 'draft';

    // Evaluate readiness if transitioning to ready_for_submission
    let isReadinessPassed: boolean | undefined = undefined;
    if (toState === 'ready_for_submission') {
      const evalResult = this.readinessService.evaluate(existingCase, actor.user_id);
      isReadinessPassed = evalResult.is_ready;
    }

    // Validate approval transition
    validateApprovalTransition({
      fromState: currentApprovalState,
      toState,
      actorUserId: actor.user_id,
      actorRole: actor.role,
      requesterUserId: requesterUserId || existingCase.assigned_to_user_id,
      requiresLegalReview: existingCase.requires_legal_review === 1,
      isReadinessPassed,
      reason
    });

    const now = new Date().toISOString();
    const approvalRecordId = uuidv4();
    const action = toState === 'rejected' ? 'rejected' : toState === 'blocked' ? 'blocked' : 'approved';

    const transaction = this.db.transaction(() => {
      this.db
        .prepare('UPDATE cases SET approval_status = ?, updated_at = ? WHERE organization_id = ? AND id = ?')
        .run(toState, now, organization_id, case_id);

      this.db
        .prepare(`
          INSERT INTO case_approval_records (
            id, case_id, organization_id, approval_type, action,
            decided_by, decision_reason, from_approval_state, to_approval_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          approvalRecordId,
          case_id,
          organization_id,
          approvalType,
          action,
          actor.user_id,
          reason,
          currentApprovalState,
          toState,
          now
        );

      this.auditService.record({
        organization_id,
        actor_user_id: actor.user_id,
        actor_email: actor.email,
        action: 'case.approval_state_changed',
        resource_type: 'case',
        resource_id: case_id,
        details: {
          from_state: currentApprovalState,
          to_state: toState,
          reason,
          approval_type: approvalType
        },
        ip_address: actor.ip_address
      });
    });

    transaction();

    return this.getCaseById(organization_id, case_id)!;
  }

  /**
   * Retrieves case approval records
   */
  public getApprovalRecords(organization_id: string, case_id: string): CaseApprovalRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM case_approval_records
      WHERE organization_id = ? AND case_id = ?
      ORDER BY created_at ASC
    `).all(organization_id, case_id) as any[];

    return rows.map((r) => ({
      id: r.id,
      case_id: r.case_id,
      organization_id: r.organization_id,
      approval_type: r.approval_type,
      action: r.action,
      decided_by: r.decided_by,
      decision_reason: r.decision_reason,
      from_approval_state: r.from_approval_state,
      to_approval_state: r.to_approval_state,
      created_at: r.created_at
    }));
  }

  /**
   * Adds an internal comment or operational note
   */
  public addNote(
    organization_id: string,
    case_id: string,
    input: CreateCaseNoteInput,
    actor: ActorContext,
    authorName: string
  ): CaseNote {
    const existingCase = this.getCaseById(organization_id, case_id);
    if (!existingCase) {
      throw new Error(`Case '${case_id}' not found in organization.`);
    }

    if (actor.role === 'read_only_stakeholder') {
      throw new Error('Read-only stakeholder cannot add case notes.');
    }

    const noteId = `note_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO case_notes (
          id, case_id, organization_id, author_user_id, author_name,
          content, is_internal_only, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        noteId,
        case_id,
        organization_id,
        actor.user_id,
        authorName,
        input.content,
        input.is_internal_only ? 1 : 0,
        now
      );

    this.auditService.record({
      organization_id,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'case.note_added',
      resource_type: 'case',
      resource_id: case_id,
      details: {
        note_id: noteId,
        is_internal_only: input.is_internal_only
      },
      ip_address: actor.ip_address
    });

    return {
      id: noteId,
      case_id,
      organization_id,
      author_user_id: actor.user_id,
      author_name: authorName,
      content: input.content,
      is_internal_only: input.is_internal_only ? 1 : 0,
      created_at: now
    };
  }

  /**
   * Retrieves full status history for a case
   */
  public getStatusHistory(organization_id: string, case_id: string): CaseStatusHistory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM case_status_history
      WHERE organization_id = ? AND case_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(organization_id, case_id) as CaseStatusHistory[];
  }

  /**
   * Retrieves notes for a case
   */
  public getNotes(organization_id: string, case_id: string): CaseNote[] {
    const stmt = this.db.prepare(`
      SELECT * FROM case_notes
      WHERE organization_id = ? AND case_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(organization_id, case_id) as CaseNote[];
  }
}
