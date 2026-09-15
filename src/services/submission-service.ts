import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  SubmissionEntity,
  SubmissionTransitionRecord,
  SubmissionApprovalRecord,
  CreateSubmissionInput,
  ApproveSubmissionFacetInput,
  Role,
  ApprovalFacet,
  SubmissionStatus
} from '../domain/types.js';
import { CaseService } from './case-service.js';
import { SubmissionPacketService } from './submission-packet-service.js';
import { PlatformRegistryService } from './platform-registry-service.js';
import { PlatformPlaybookService } from './platform-playbook-service.js';
import { ReadinessService } from './readiness-service.js';
import { AuditService } from './audit-service.js';
import {
  validateSubmissionTransition,
  SubmissionStateMachineError
} from '../domain/submission-state-machine.js';
import {
  LocalDryRunSubmissionAdapter,
  ValidationResult,
  SubmissionPreview,
  SimulationResult
} from '../domain/submission-adapter.js';

export class SubmissionService {
  private db: Database.Database;
  private caseService: CaseService;
  private packetService: SubmissionPacketService;
  private platformRegistryService: PlatformRegistryService;
  private playbookService: PlatformPlaybookService;
  private readinessService: ReadinessService;
  private auditService: AuditService;
  private adapter: LocalDryRunSubmissionAdapter;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.caseService = new CaseService(this.db);
    this.packetService = new SubmissionPacketService(this.db);
    this.platformRegistryService = new PlatformRegistryService(this.db);
    this.playbookService = new PlatformPlaybookService(this.db);
    this.readinessService = new ReadinessService(this.db);
    this.auditService = new AuditService(this.db);
    this.adapter = new LocalDryRunSubmissionAdapter();
  }

  async createSubmission(
    input: CreateSubmissionInput,
    actorUserId: string,
    organizationId: string
  ): Promise<SubmissionEntity> {
    const caseItem = this.caseService.getCaseById(organizationId, input.case_id);
    if (!caseItem) {
      throw new Error(`Case with ID ${input.case_id} not found in active organization.`);
    }

    const platform = this.platformRegistryService.getPlatformById(input.platform_id);
    if (!platform) {
      throw new Error(`Platform with ID ${input.platform_id} not found.`);
    }

    const playbook = this.playbookService.getPlaybookById(input.playbook_id);
    if (!playbook) {
      throw new Error(`Playbook with ID ${input.playbook_id} not found.`);
    }

    // Generate canonical packet
    const generatedPacket = this.packetService.generatePacket(caseItem, actorUserId);
    const packetPayload = JSON.parse(generatedPacket.packet_json);
    const packetMarkdown = generatedPacket.packet_markdown;
    const packetHash = generatedPacket.packet_hash;

    const submissionId = `sub_${uuidv4().replace(/-/g, '')}`;

    const insertSubmission = this.db.prepare(`
      INSERT INTO submissions (
        id, case_id, organization_id, platform_id, playbook_id, status,
        packet_version, packet_hash, packet_payload_json, packet_markdown,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const insertTransition = this.db.prepare(`
      INSERT INTO submission_transitions (
        id, submission_id, organization_id, from_state, to_state,
        actor_user_id, actor_role, reason, packet_hash, created_at
      ) VALUES (?, ?, ?, 'draft', 'draft', ?, 'analyst', 'Submission initialized as draft', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      insertSubmission.run(
        submissionId,
        input.case_id,
        organizationId,
        input.platform_id,
        input.playbook_id,
        packetHash,
        JSON.stringify(packetPayload, null, 2),
        packetMarkdown,
        actorUserId
      );

      insertTransition.run(
        `st_${uuidv4().replace(/-/g, '')}`,
        submissionId,
        organizationId,
        actorUserId,
        packetHash
      );

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'submission.created',
        resource_type: 'submission',
        resource_id: submissionId,
        details: {
          case_id: input.case_id,
          platform_id: input.platform_id,
          playbook_id: input.playbook_id,
          packet_hash: packetHash
        }
      });
    });

    tx();

    return this.getSubmissionById(submissionId, organizationId)!;
  }

  getSubmissionsForCase(caseId: string, organizationId: string): SubmissionEntity[] {
    const rows = this.db
      .prepare('SELECT * FROM submissions WHERE case_id = ? AND organization_id = ? ORDER BY created_at DESC')
      .all(caseId, organizationId) as SubmissionEntity[];
    return rows;
  }

  getSubmissionById(id: string, organizationId: string): SubmissionEntity | null {
    const row = this.db
      .prepare('SELECT * FROM submissions WHERE id = ? AND organization_id = ?')
      .get(id, organizationId) as SubmissionEntity | undefined;
    return row || null;
  }

  validateSubmission(id: string, organizationId: string): ValidationResult {
    const submission = this.getSubmissionById(id, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${id} not found.`);
    }

    const payload = JSON.parse(submission.packet_payload_json);
    const baseResult = this.adapter.validate(payload);

    const playbook = this.playbookService.getPlaybookById(submission.playbook_id);
    if (playbook) {
      for (const field of playbook.required_intake_fields) {
        if (!payload.incident_details?.[field] && !payload.affected_party?.[field] && !payload[field]) {
          if (!baseResult.missingFields.includes(field)) {
            baseResult.missingFields.push(field);
          }
        }
      }
      if (baseResult.missingFields.length > 0) {
        baseResult.isValid = false;
      }
    }

    return baseResult;
  }

  previewSubmission(id: string, organizationId: string): SubmissionPreview {
    const submission = this.getSubmissionById(id, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${id} not found.`);
    }

    const payload = JSON.parse(submission.packet_payload_json);
    return this.adapter.preview(payload);
  }

  async transitionState(
    submissionId: string,
    organizationId: string,
    actorUserId: string,
    actorRole: Role,
    toState: SubmissionStatus,
    reason: string
  ): Promise<SubmissionEntity> {
    const submission = this.getSubmissionById(submissionId, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${submissionId} not found.`);
    }

    // Check readiness if attempting to move to ready_for_review
    let isReadinessPassed = true;
    if (toState === 'ready_for_review') {
      const caseItem = this.caseService.getCaseById(organizationId, submission.case_id);
      if (caseItem) {
        const readiness = this.readinessService.evaluate(caseItem, actorUserId);
        isReadinessPassed = readiness.is_ready;
      }
    }

    // Check deleted evidence
    const hasDeleted = this.checkHasDeletedEvidence(submission.case_id, organizationId);

    // Get active approvals
    const approvals = this.getApprovals(submissionId, organizationId);
    const approvedFacets = approvals
      .filter((a) => a.decision === 'approved' && a.is_superseded === 0)
      .map((a) => a.approval_facet);

    const playbook = this.playbookService.getPlaybookById(submission.playbook_id);
    const requiredFacets = (playbook?.human_approval_requirements || []) as ApprovalFacet[];

    validateSubmissionTransition({
      fromState: submission.status,
      toState,
      actorUserId,
      actorRole,
      creatorUserId: submission.created_by,
      isReadinessPassed,
      requiredApprovalFacets: requiredFacets,
      approvedFacets,
      hasDeletedEvidence: hasDeleted,
      currentPacketHash: submission.packet_hash,
      approvedPacketHash: approvals[0]?.packet_hash || submission.packet_hash,
      reason
    });

    const updateStmt = this.db.prepare(`
      UPDATE submissions
      SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND organization_id = ?
    `);

    const transitionStmt = this.db.prepare(`
      INSERT INTO submission_transitions (
        id, submission_id, organization_id, from_state, to_state,
        actor_user_id, actor_role, reason, packet_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      updateStmt.run(toState, submissionId, organizationId);
      transitionStmt.run(
        `st_${uuidv4().replace(/-/g, '')}`,
        submissionId,
        organizationId,
        submission.status,
        toState,
        actorUserId,
        actorRole,
        reason,
        submission.packet_hash
      );

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'submission.state_transition',
        resource_type: 'submission',
        resource_id: submissionId,
        details: {
          from_state: submission.status,
          to_state: toState,
          reason,
          packet_hash: submission.packet_hash
        }
      });
    });

    tx();

    return this.getSubmissionById(submissionId, organizationId)!;
  }

  async approveFacet(
    submissionId: string,
    organizationId: string,
    actorUserId: string,
    actorRole: Role,
    input: ApproveSubmissionFacetInput
  ): Promise<SubmissionApprovalRecord> {
    const submission = this.getSubmissionById(submissionId, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${submissionId} not found.`);
    }

    // Packet hash must strictly match current packet
    if (submission.packet_hash !== input.packet_hash) {
      throw new SubmissionStateMachineError(
        'The approved packet hash does not match the current submission packet hash. Packet may have been modified.',
        'PACKET_HASH_MISMATCH'
      );
    }

    // Separation of Duties: Requester cannot self-approve legal review or simulated submission
    if (
      (input.approval_facet === 'legal_sufficiency' || input.approval_facet === 'simulated_submission') &&
      submission.created_by === actorUserId
    ) {
      throw new SubmissionStateMachineError(
        'Separation of duties violation: Submission creator cannot self-approve this facet.',
        'SEPARATION_OF_DUTIES_VIOLATION'
      );
    }

    // Role verification
    if (input.approval_facet === 'legal_sufficiency') {
      if (actorRole !== 'legal_reviewer' && actorRole !== 'org_owner' && actorRole !== 'system_admin') {
        throw new SubmissionStateMachineError(
          'Only Legal Reviewers, Org Owners, or System Admins can approve legal sufficiency.',
          'ROLE_UNAUTHORIZED'
        );
      }
    }

    const approvalId = `apv_${uuidv4().replace(/-/g, '')}`;

    // Mark previous approvals for this facet as superseded
    const supersedeStmt = this.db.prepare(`
      UPDATE submission_approvals
      SET is_superseded = 1
      WHERE submission_id = ? AND approval_facet = ?
    `);

    const insertApproval = this.db.prepare(`
      INSERT INTO submission_approvals (
        id, submission_id, organization_id, approval_facet, packet_hash,
        packet_version, decided_by, decided_role, decision, decision_reason,
        is_superseded, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      supersedeStmt.run(submissionId, input.approval_facet);
      insertApproval.run(
        approvalId,
        submissionId,
        organizationId,
        input.approval_facet,
        input.packet_hash,
        submission.packet_version,
        actorUserId,
        actorRole,
        input.decision,
        input.decision_reason
      );

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'approver@desk.example',
        action: `submission.approval_${input.decision}`,
        resource_type: 'submission',
        resource_id: submissionId,
        details: {
          approval_facet: input.approval_facet,
          packet_hash: input.packet_hash,
          reason: input.decision_reason
        }
      });

      // Check if all required facets are now approved; if so, advance to approved_for_simulation
      const playbook = this.playbookService.getPlaybookById(submission.playbook_id);
      const requiredFacets = (playbook?.human_approval_requirements || []) as ApprovalFacet[];

      const activeApprovals = this.db
        .prepare(`
          SELECT approval_facet FROM submission_approvals
          WHERE submission_id = ? AND packet_hash = ? AND decision = 'approved' AND is_superseded = 0
        `)
        .all(submissionId, input.packet_hash) as { approval_facet: ApprovalFacet }[];

      const approvedSet = new Set(activeApprovals.map((a) => a.approval_facet));
      const allApproved = requiredFacets.every((f) => approvedSet.has(f));

      if (allApproved && (submission.status === 'ready_for_review' || submission.status === 'draft')) {
        this.db
          .prepare("UPDATE submissions SET status = 'approved_for_simulation' WHERE id = ?")
          .run(submissionId);

        this.db.prepare(`
          INSERT INTO submission_transitions (
            id, submission_id, organization_id, from_state, to_state,
            actor_user_id, actor_role, reason, packet_hash, created_at
          ) VALUES (?, ?, ?, ?, 'approved_for_simulation', ?, ?, 'All required approval facets approved', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        `).run(
          `st_${uuidv4().replace(/-/g, '')}`,
          submissionId,
          organizationId,
          submission.status,
          actorUserId,
          actorRole,
          submission.packet_hash
        );
      }
    });

    tx();

    return {
      id: approvalId,
      submission_id: submissionId,
      organization_id: organizationId,
      approval_facet: input.approval_facet,
      packet_hash: input.packet_hash,
      packet_version: submission.packet_version,
      decided_by: actorUserId,
      decided_role: actorRole,
      decision: input.decision,
      decision_reason: input.decision_reason,
      is_superseded: 0,
      created_at: new Date().toISOString()
    };
  }

  getApprovals(submissionId: string, organizationId: string): SubmissionApprovalRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM submission_approvals
        WHERE submission_id = ? AND organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(submissionId, organizationId) as SubmissionApprovalRecord[];
    return rows;
  }

  async simulateSubmission(
    submissionId: string,
    organizationId: string,
    actorUserId: string,
    actorRole: Role
  ): Promise<{ submission: SubmissionEntity; simulation: SimulationResult }> {
    const submission = this.getSubmissionById(submissionId, organizationId);
    if (!submission) {
      throw new Error(`Submission with ID ${submissionId} not found.`);
    }

    if (submission.status !== 'approved_for_simulation') {
      throw new SubmissionStateMachineError(
        `Cannot simulate submission in status '${submission.status}'. Must be 'approved_for_simulation'.`,
        'SUBMISSION_NOT_APPROVED'
      );
    }

    // Role check: Analyst cannot execute simulation
    if (actorRole === 'analyst') {
      throw new SubmissionStateMachineError(
        'Analysts cannot dispatch simulated platform submissions. Requires Case Manager, Legal Reviewer, or Admin.',
        'ROLE_UNAUTHORIZED'
      );
    }

    // Check deleted evidence
    if (this.checkHasDeletedEvidence(submission.case_id, organizationId)) {
      throw new SubmissionStateMachineError(
        'Cannot proceed: Evidence attached to this submission packet has been deleted or quarantined.',
        'DELETED_EVIDENCE_IN_PACKET'
      );
    }

    const payload = JSON.parse(submission.packet_payload_json);
    const simulationResult = await this.adapter.simulate(payload);

    const updateStmt = this.db.prepare(`
      UPDATE submissions
      SET status = 'simulated_submitted',
          simulated_reference_id = ?,
          simulated_at = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND organization_id = ?
    `);

    const transitionStmt = this.db.prepare(`
      INSERT INTO submission_transitions (
        id, submission_id, organization_id, from_state, to_state,
        actor_user_id, actor_role, reason, packet_hash, created_at
      ) VALUES (?, ?, ?, 'approved_for_simulation', 'simulated_submitted', ?, ?, 'Dry-run platform submission simulation executed', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);

    const tx = this.db.transaction(() => {
      updateStmt.run(
        simulationResult.simulatedReferenceId,
        simulationResult.simulatedAt,
        submissionId,
        organizationId
      );

      transitionStmt.run(
        `st_${uuidv4().replace(/-/g, '')}`,
        submissionId,
        organizationId,
        actorUserId,
        actorRole,
        submission.packet_hash
      );

      this.auditService.record({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        actor_email: 'operator@desk.example',
        action: 'submission.simulated',
        resource_type: 'submission',
        resource_id: submissionId,
        details: {
          simulated_reference_id: simulationResult.simulatedReferenceId,
          packet_hash: submission.packet_hash,
          mode: simulationResult.mode
        }
      });
    });

    tx();

    return {
      submission: this.getSubmissionById(submissionId, organizationId)!,
      simulation: simulationResult
    };
  }

  getTransitions(submissionId: string, organizationId: string): SubmissionTransitionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM submission_transitions
        WHERE submission_id = ? AND organization_id = ?
        ORDER BY created_at ASC
      `)
      .all(submissionId, organizationId) as SubmissionTransitionRecord[];
    return rows;
  }

  private checkHasDeletedEvidence(caseId: string, organizationId: string): boolean {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) as count FROM evidence_items
        WHERE case_id = ? AND organization_id = ?
        AND status IN ('deleted', 'retention_expired', 'quarantined', 'deletion_requested', 'rejected')
      `)
      .get(caseId, organizationId) as { count: number };
    return row.count > 0;
  }
}
