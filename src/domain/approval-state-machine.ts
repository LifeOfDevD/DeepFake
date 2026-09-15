import { ApprovalState, Role } from './types.js';

export class ApprovalStateMachineError extends Error {
  constructor(message: string, public readonly code: string = 'ILLEGAL_APPROVAL_TRANSITION') {
    super(message);
    this.name = 'ApprovalStateMachineError';
  }
}

export const ALLOWED_APPROVAL_TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
  draft: ['triage_complete', 'awaiting_legal_review', 'ready_for_submission', 'blocked', 'rejected'],
  triage_complete: ['awaiting_legal_review', 'ready_for_submission', 'blocked', 'rejected'],
  awaiting_legal_review: ['legal_review_approved', 'ready_for_submission', 'blocked', 'rejected'],
  legal_review_approved: ['ready_for_submission', 'blocked', 'rejected'],
  ready_for_submission: ['submission_simulated', 'awaiting_legal_review', 'blocked', 'rejected'],
  submission_simulated: ['draft'], // Can be reopened if new facts emerge
  rejected: ['draft', 'triage_complete'], // Can be reopened for amendment
  blocked: ['draft', 'triage_complete']   // Can be unblocked by manager/admin
};

export interface ApprovalTransitionContext {
  fromState: ApprovalState;
  toState: ApprovalState;
  actorUserId: string;
  actorRole: Role;
  requesterUserId?: string | null;
  requiresLegalReview: boolean;
  isReadinessPassed?: boolean;
  reason?: string;
}

export function validateApprovalTransition(ctx: ApprovalTransitionContext): void {
  const {
    fromState,
    toState,
    actorUserId,
    actorRole,
    requesterUserId,
    requiresLegalReview,
    isReadinessPassed,
    reason
  } = ctx;

  if (fromState === toState) {
    return; // No-op
  }

  // 1. Graph validity
  const allowed = ALLOWED_APPROVAL_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new ApprovalStateMachineError(
      `Cannot transition approval state from '${fromState}' to '${toState}'. Allowed: [${allowed.join(', ')}]`,
      'INVALID_APPROVAL_TRANSITION'
    );
  }

  // 2. Read-only stakeholder cannot modify approval state
  if (actorRole === 'read_only_stakeholder') {
    throw new ApprovalStateMachineError(
      'Read-only stakeholder is not authorized to transition case approval state.',
      'ROLE_UNAUTHORIZED'
    );
  }

  // 3. Rejection or blocking requires reason
  if (toState === 'rejected' || toState === 'blocked') {
    if (!reason || reason.trim().length < 3) {
      throw new ApprovalStateMachineError(
        `Transitioning to '${toState}' requires a substantive justification (minimum 3 characters).`,
        'REASON_REQUIRED'
      );
    }
    if (actorRole === 'analyst') {
      throw new ApprovalStateMachineError(
        `Analyst cannot unilaterally ${toState} a case. Requires Case Manager, Legal Reviewer, or Admin.`,
        'ROLE_UNAUTHORIZED'
      );
    }
    return;
  }

  // 4. Moving to legal_review_approved
  if (toState === 'legal_review_approved') {
    if (actorRole !== 'legal_reviewer' && actorRole !== 'org_owner' && actorRole !== 'system_admin') {
      throw new ApprovalStateMachineError(
        'Only Legal Reviewers, Org Owners, or System Admins can approve legal review.',
        'LEGAL_ROLE_REQUIRED'
      );
    }

    // Separation of Duties: Requester cannot self-approve legal review
    if (requesterUserId && actorUserId && requesterUserId === actorUserId) {
      throw new ApprovalStateMachineError(
        'Separation of duties violation: The user who requested legal review cannot self-approve it. An independent reviewer is required.',
        'SEPARATION_OF_DUTIES_VIOLATION'
      );
    }
  }

  // 5. Advancing to ready_for_submission
  if (toState === 'ready_for_submission') {
    if (actorRole === 'analyst') {
      throw new ApprovalStateMachineError(
        'Analysts cannot mark a case as ready for submission. Requires Case Manager, Legal Reviewer, or Admin approval.',
        'ROLE_UNAUTHORIZED'
      );
    }

    // Must have legal review if required
    if (requiresLegalReview && fromState !== 'legal_review_approved') {
      throw new ApprovalStateMachineError(
        'This incident requires legal review before it can be marked ready for submission.',
        'LEGAL_APPROVAL_REQUIRED'
      );
    }

    // Readiness engine check: cannot be marked ready if readiness failed
    if (isReadinessPassed === false) {
      throw new ApprovalStateMachineError(
        'Cannot mark case ready for submission: blocking readiness requirements remain unfulfilled.',
        'READINESS_CHECK_FAILED'
      );
    }
  }

  // 6. Simulating submission
  if (toState === 'submission_simulated') {
    if (fromState !== 'ready_for_submission') {
      throw new ApprovalStateMachineError(
        'Cannot simulate submission unless the case is in ready_for_submission state.',
        'APPROVAL_GATE_VIOLATION'
      );
    }
  }
}
