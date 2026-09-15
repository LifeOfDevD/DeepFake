import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  CaseEscalationRecord,
  CreateEscalationInput,
  ResolveEscalationInput
} from '../domain/types.js';
import { WorkflowTaskService } from './workflow-task-service.js';
import { AuditService } from './audit-service.js';

export class EscalationService {
  private db: Database.Database;
  private taskService: WorkflowTaskService;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.taskService = new WorkflowTaskService(this.db);
    this.auditService = new AuditService(this.db);
  }

  async createEscalation(
    input: CreateEscalationInput,
    actorUserId: string,
    organizationId: string
  ): Promise<CaseEscalationRecord> {
    const escalationId = `esc_${uuidv4().replace(/-/g, '')}`;

    const insertStmt = this.db.prepare(`
      INSERT INTO case_escalations (
        id, case_id, submission_id, organization_id, trigger_type,
        severity, assigned_owner_id, due_at, recommended_next_action,
        supporting_evidence_ids, resolution_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      insertStmt.run(
        escalationId,
        input.case_id,
        input.submission_id || null,
        organizationId,
        input.trigger_type,
        input.severity,
        input.assigned_owner_id || null,
        input.due_at || null,
        input.recommended_next_action,
        JSON.stringify(input.supporting_evidence_ids || []),
        actorUserId
      );

      // Create high-priority workflow task
      this.taskService.createTask({
        caseId: input.case_id,
        organizationId,
        taskType: 'overdue_escalation',
        priority: input.severity === 'p1' ? 'p1' : 'p2',
        assignedRole: 'legal_reviewer',
        creationReason: `Escalation triggered: ${input.trigger_type}. Recommended: ${input.recommended_next_action}`
      });

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'case_escalation.created',
        resource_type: 'case_escalation',
        resource_id: escalationId,
        details: {
          case_id: input.case_id,
          trigger_type: input.trigger_type,
          severity: input.severity,
          recommended_action: input.recommended_next_action
        }
      });
    });

    tx();

    return this.getEscalationById(escalationId, organizationId)!;
  }

  getEscalationsForCase(caseId: string, organizationId: string): CaseEscalationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM case_escalations
        WHERE case_id = ? AND organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(caseId, organizationId) as any[];

    return rows.map(this.mapEscalationRow);
  }

  getEscalationById(id: string, organizationId: string): CaseEscalationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM case_escalations WHERE id = ? AND organization_id = ?')
      .get(id, organizationId) as any;

    return row ? this.mapEscalationRow(row) : null;
  }

  async resolveEscalation(
    id: string,
    organizationId: string,
    actorUserId: string,
    input: ResolveEscalationInput
  ): Promise<CaseEscalationRecord> {
    const escalation = this.getEscalationById(id, organizationId);
    if (!escalation) {
      throw new Error(`Escalation with ID ${id} not found.`);
    }

    const resolvedAt = new Date().toISOString();

    const updateStmt = this.db.prepare(`
      UPDATE case_escalations
      SET resolution_status = ?,
          resolution_notes = ?,
          resolved_at = ?,
          resolved_by = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND organization_id = ?
    `);

    const tx = this.db.transaction(() => {
      updateStmt.run(
        input.resolution_status,
        input.resolution_notes,
        resolvedAt,
        actorUserId,
        id,
        organizationId
      );

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'case_escalation.resolved',
        resource_type: 'case_escalation',
        resource_id: id,
        details: {
          resolution_status: input.resolution_status,
          notes: input.resolution_notes
        }
      });
    });

    tx();

    return this.getEscalationById(id, organizationId)!;
  }

  private mapEscalationRow(row: any): CaseEscalationRecord {
    return {
      ...row,
      supporting_evidence_ids: JSON.parse(row.supporting_evidence_ids || '[]')
    };
  }
}
