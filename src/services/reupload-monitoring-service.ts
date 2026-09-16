import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  RelatedContentObservationRecord,
  AddRelatedContentInput,
  UpdateRelatedContentStatusInput
} from '../domain/types.js';
import { DuplicateDetectionService } from './duplicate-detection-service.js';
import { WorkflowTaskService } from './workflow-task-service.js';
import { AuditService } from './audit-service.js';

export class ReuploadMonitoringService {
  private db: Database.Database;
  private duplicateDetectionService: DuplicateDetectionService;
  private taskService: WorkflowTaskService;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.duplicateDetectionService = new DuplicateDetectionService(this.db);
    this.taskService = new WorkflowTaskService(this.db);
    this.auditService = new AuditService(this.db);
  }

  async addObservation(
    input: AddRelatedContentInput,
    actorUserId: string,
    organizationId: string
  ): Promise<RelatedContentObservationRecord> {
    const observationId = `rel_${uuidv4().replace(/-/g, '')}`;
    const normalizedUrl = this.duplicateDetectionService.normalizeUrl(input.observed_url);

    const insertStmt = this.db.prepare(`
      INSERT INTO related_content_observations (
        id, case_id, organization_id, observed_url, normalized_url,
        platform_id, target_entity, relationship, similarity_score,
        operator_notes, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      insertStmt.run(
        observationId,
        input.case_id,
        organizationId,
        input.observed_url,
        normalizedUrl,
        input.platform_id || null,
        input.target_entity,
        input.relationship,
        input.similarity_score,
        input.operator_notes || null,
        input.status || 'suspected',
        actorUserId
      );

      // If suspected re-upload or mirror, generate follow-up task
      if (
        input.relationship === 'same_content' ||
        input.relationship === 'modified_reupload' ||
        input.relationship === 'mirror'
      ) {
        this.taskService.createTask({
          caseId: input.case_id,
          organizationId,
          taskType: 'duplicate_incident_review',
          priority: 'p2',
          assignedRole: 'analyst',
          creationReason: `Re-upload observation recorded: ${input.relationship} at ${input.observed_url}`
        });
      }

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'related_content.observed',
        resource_type: 'related_content_observation',
        resource_id: observationId,
        details: {
          case_id: input.case_id,
          observed_url: input.observed_url,
          relationship: input.relationship,
          similarity_score: input.similarity_score
        }
      });
    });

    tx();

    return this.getObservationById(observationId, organizationId)!;
  }

  getObservationsForCase(caseId: string, organizationId: string): RelatedContentObservationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM related_content_observations
        WHERE case_id = ? AND organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(caseId, organizationId) as RelatedContentObservationRecord[];
    return rows;
  }

  getObservationsForOrganization(organizationId: string): RelatedContentObservationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM related_content_observations
        WHERE organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(organizationId) as RelatedContentObservationRecord[];
    return rows;
  }

  getObservationById(id: string, organizationId: string): RelatedContentObservationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM related_content_observations WHERE id = ? AND organization_id = ?')
      .get(id, organizationId) as RelatedContentObservationRecord | undefined;
    return row || null;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    actorUserId: string,
    input: UpdateRelatedContentStatusInput
  ): Promise<RelatedContentObservationRecord> {
    const obs = this.getObservationById(id, organizationId);
    if (!obs) {
      throw new Error(`Observation with ID ${id} not found.`);
    }

    const updateStmt = this.db.prepare(`
      UPDATE related_content_observations
      SET status = ?,
          operator_notes = COALESCE(?, operator_notes),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND organization_id = ?
    `);

    const tx = this.db.transaction(() => {
      updateStmt.run(input.status, input.operator_notes || null, id, organizationId);

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'related_content.status_updated',
        resource_type: 'related_content_observation',
        resource_id: id,
        details: {
          previous_status: obs.status,
          new_status: input.status,
          notes: input.operator_notes
        }
      });
    });

    tx();

    return this.getObservationById(id, organizationId)!;
  }
}
