import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  SubmissionResponseRecord,
  RecordAcknowledgementInput,
  RecordPlatformDecisionInput
} from '../domain/types.js';
import { SubmissionService } from './submission-service.js';
import { WorkflowTaskService } from './workflow-task-service.js';
import { AuditService } from './audit-service.js';

export class ResponseTrackingService {
  private db: Database.Database;
  private submissionService: SubmissionService;
  private taskService: WorkflowTaskService;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.submissionService = new SubmissionService(this.db);
    this.taskService = new WorkflowTaskService(this.db);
    this.auditService = new AuditService(this.db);
  }

  async recordAcknowledgement(
    submissionId: string,
    organizationId: string,
    actorUserId: string,
    input: RecordAcknowledgementInput
  ): Promise<SubmissionResponseRecord> {
    const submission = this.submissionService.getSubmissionById(submissionId, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${submissionId} not found.`);
    }

    const responseId = `resp_${uuidv4().replace(/-/g, '')}`;
    const ackTime = input.acknowledgement_received_at || new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT INTO submission_responses (
        id, submission_id, platform_id, organization_id,
        acknowledgement_received_at, platform_reference_number,
        response_category, takedown_result, operator_notes,
        recorded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'acknowledged_pending_review', 'pending', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      insertStmt.run(
        responseId,
        submissionId,
        submission.platform_id,
        organizationId,
        ackTime,
        input.platform_reference_number,
        input.operator_notes || null,
        actorUserId
      );

      // Advance submission state to 'acknowledged' if currently simulated_submitted
      if (submission.status === 'simulated_submitted') {
        this.submissionService.transitionState(
          submissionId,
          organizationId,
          actorUserId,
          'case_manager',
          'acknowledged',
          `Platform acknowledgement recorded. Reference: ${input.platform_reference_number}`
        );
      }

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'submission_response.acknowledged',
        resource_type: 'submission_response',
        resource_id: responseId,
        details: {
          submission_id: submissionId,
          reference_number: input.platform_reference_number,
          acknowledged_at: ackTime
        }
      });
    });

    tx();

    return this.getResponseById(responseId, organizationId)!;
  }

  async recordDecision(
    submissionId: string,
    organizationId: string,
    actorUserId: string,
    input: RecordPlatformDecisionInput
  ): Promise<SubmissionResponseRecord> {
    const submission = this.submissionService.getSubmissionById(submissionId, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${submissionId} not found.`);
    }

    const responseId = `resp_${uuidv4().replace(/-/g, '')}`;
    const decisionTime = input.response_received_at || new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT INTO submission_responses (
        id, submission_id, platform_id, organization_id,
        response_received_at, platform_reference_number,
        response_category, requested_additional_information,
        takedown_result, rejection_reason, escalation_required,
        operator_notes, attached_evidence_ids, recorded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      insertStmt.run(
        responseId,
        submissionId,
        submission.platform_id,
        organizationId,
        decisionTime,
        input.platform_reference_number || null,
        input.response_category,
        input.requested_additional_information || null,
        input.takedown_result,
        input.rejection_reason || null,
        input.escalation_required ? 1 : 0,
        input.operator_notes || null,
        JSON.stringify(input.attached_evidence_ids || []),
        actorUserId
      );

      // Determine next submission state
      if (input.takedown_result === 'removed' || input.takedown_result === 'account_suspended') {
        this.submissionService.transitionState(
          submissionId,
          organizationId,
          actorUserId,
          'case_manager',
          'action_taken',
          `Platform confirmed takedown action: ${input.takedown_result}`
        );
      } else if (input.escalation_required || input.response_category === 'appeal_suggested') {
        this.submissionService.transitionState(
          submissionId,
          organizationId,
          actorUserId,
          'case_manager',
          'escalation_required',
          `Platform response indicates escalation needed: ${input.response_category}`
        );

        // Generate operational task for legal/case manager
        this.taskService.createTask({
          caseId: submission.case_id,
          organizationId,
          taskType: 'overdue_escalation',
          priority: 'p1',
          assignedRole: 'case_manager',
          creationReason: `Platform response required escalation: ${input.rejection_reason || input.response_category}`
        });
      } else if (input.response_category === 'not_violating_policy' || input.response_category === 'insufficient_evidence') {
        this.submissionService.transitionState(
          submissionId,
          organizationId,
          actorUserId,
          'case_manager',
          'rejected',
          `Platform rejected complaint: ${input.rejection_reason || input.response_category}`
        );
      }

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'submission_response.decision_recorded',
        resource_type: 'submission_response',
        resource_id: responseId,
        details: {
          submission_id: submissionId,
          response_category: input.response_category,
          takedown_result: input.takedown_result,
          escalation_required: input.escalation_required
        }
      });
    });

    tx();

    return this.getResponseById(responseId, organizationId)!;
  }

  getResponsesForSubmission(submissionId: string, organizationId: string): SubmissionResponseRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM submission_responses
        WHERE submission_id = ? AND organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(submissionId, organizationId) as any[];

    return rows.map((r) => ({
      ...r,
      attached_evidence_ids: JSON.parse(r.attached_evidence_ids || '[]')
    }));
  }

  getResponseById(id: string, organizationId: string): SubmissionResponseRecord | null {
    const row = this.db
      .prepare('SELECT * FROM submission_responses WHERE id = ? AND organization_id = ?')
      .get(id, organizationId) as any;

    if (!row) return null;
    return {
      ...row,
      attached_evidence_ids: JSON.parse(row.attached_evidence_ids || '[]')
    };
  }
}
