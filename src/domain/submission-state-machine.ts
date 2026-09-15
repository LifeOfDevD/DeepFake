import {
  SubmissionStatus,
  Role,
  ApprovalFacet
} from './types.js';

export class SubmissionStateMachineError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SubmissionStateMachineError';
  }
}

export const ALLOWED_SUBMISSION_TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  draft: ['needs_information', 'ready_for_review'],
  needs_information: ['draft', 'ready_for_review'],
  ready_for_review: ['approved_for_simulation', 'needs_information', 'rejected'],
  approved_for_simulation: ['simulated_submitted', 'needs_information', 'rejected'],
  simulated_submitted: ['acknowledged', 'response_received', 'action_taken', 'rejected', 'escalation_required'],
  acknowledged: ['response_received', 'action_taken', 'rejected', 'escalation_required', 'closed'],
  response_received: ['action_taken', 'rejected', 'escalation_required', 'closed'],
  action_taken: ['closed', 'escalation_required'],
  rejected: ['escalation_required', 'closed'],
  escalation_required: ['ready_for_review', 'approved_for_simulation', 'closed'],
  closed: ['escalation_required']
};

export interface SubmissionTransitionContext {
  fromState: SubmissionStatus;
  toState: SubmissionStatus;
  actorUserId: string;
  actorRole: Role;
  creatorUserId?: string | null;
  isReadinessPassed?: boolean;
  requiredApprovalFacets?: ApprovalFacet[];
  approvedFacets?: ApprovalFacet[];
  hasDeletedEvidence?: boolean;
  currentPacketHash?: string;
  approvedPacketHash?: string;
  reason?: string;
}

export function validateSubmissionTransition(ctx: SubmissionTransitionContext): void {
  const {
    fromState,
    toState,
    actorUserId,
    actorRole,
    creatorUserId,
    isReadinessPassed,
    requiredApprovalFacets = [],
    approvedFacets = [],
    hasDeletedEvidence = false,
    currentPacketHash,
    approvedPacketHash,
    reason
  } = ctx;

  if (fromState === toState) {
    return; // No-op
  }

  // 1. Graph validity
  const allowed = ALLOWED_SUBMISSION_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new SubmissionStateMachineError(
      `Cannot transition submission from '${fromState}' to '${toState}'. Allowed: [${allowed.join(', ')}]`,
      'INVALID_SUBMISSION_TRANSITION'
    );
  }

  // 2. Read-only stakeholder cannot modify submission state
  if (actorRole === 'read_only_stakeholder') {
    throw new SubmissionStateMachineError(
      'Read-only stakeholder is not authorized to transition submission state.',
      'ROLE_UNAUTHORIZED'
    );
  }

  // 3. Prevent submission with deleted or expired evidence
  if (hasDeletedEvidence) {
    throw new SubmissionStateMachineError(
      'Cannot proceed: One or more evidence artifacts in this submission packet have been deleted, quarantined, or expired.',
      'DELETED_EVIDENCE_IN_PACKET'
    );
  }

  // 4. Moving to ready_for_review requires passed readiness
  if (toState === 'ready_for_review') {
    if (isReadinessPassed === false) {
      throw new SubmissionStateMachineError(
        'Submission cannot be moved to ready_for_review: Case readiness checks have not passed.',
        'READINESS_CHECK_FAILED'
      );
    }
  }

  // 5. Moving to approved_for_simulation requires all required approval facets on current packet hash
  if (toState === 'approved_for_simulation') {
    if (actorRole === 'analyst') {
      throw new SubmissionStateMachineError(
        'Analysts cannot approve submissions for simulation. Requires Case Manager, Legal Reviewer, or Admin.',
        'ROLE_UNAUTHORIZED'
      );
    }

    if (creatorUserId && actorUserId && creatorUserId === actorUserId) {
      throw new SubmissionStateMachineError(
        'Separation of duties violation: Submission creator cannot approve submission for simulation.',
        'SEPARATION_OF_DUTIES_VIOLATION'
      );
    }

    if (currentPacketHash && approvedPacketHash && currentPacketHash !== approvedPacketHash) {
      throw new SubmissionStateMachineError(
        'Packet hash mismatch: The current submission packet differs from the approved packet hash. Re-approval is required.',
        'PACKET_HASH_MISMATCH'
      );
    }

    // Check all required approval facets are fulfilled
    for (const facet of requiredApprovalFacets) {
      if (!approvedFacets.includes(facet)) {
        throw new SubmissionStateMachineError(
          `Cannot approve for simulation: Missing required human approval facet '${facet}'.`,
          'MISSING_APPROVAL_FACET'
        );
      }
    }
  }

  // 6. Moving to simulated_submitted requires prior approval_for_simulation
  if (toState === 'simulated_submitted') {
    if (fromState !== 'approved_for_simulation') {
      throw new SubmissionStateMachineError(
        'Submission simulation can only be executed when status is approved_for_simulation.',
        'SUBMISSION_NOT_APPROVED'
      );
    }
  }

  // 7. Rejection or escalation requires reason
  if (toState === 'rejected' || toState === 'escalation_required') {
    if (!reason || reason.trim().length < 3) {
      throw new SubmissionStateMachineError(
        `Transitioning to '${toState}' requires a substantive justification (minimum 3 characters).`,
        'REASON_REQUIRED'
      );
    }
  }
}
