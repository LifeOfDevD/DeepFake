import { CaseStatus, Role, CATEGORIES_REQUIRING_LEGAL_REVIEW, IncidentCategory } from './types.js';

export class StateMachineError extends Error {
  constructor(message: string, public readonly code: string = 'ILLEGAL_STATE_TRANSITION') {
    super(message);
    this.name = 'StateMachineError';
  }
}

// Complete graph of permissible transitions
export const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  new: ['triage', 'blocked'],
  triage: ['awaiting_authority', 'rejected', 'blocked'],
  awaiting_authority: ['evidence_collection', 'rejected', 'blocked'],
  evidence_collection: ['human_review', 'rejected', 'blocked'],
  human_review: ['ready_for_submission', 'rejected', 'blocked'],
  ready_for_submission: ['submitted', 'human_review', 'rejected'],
  submitted: ['awaiting_response'],
  awaiting_response: ['resolved', 'escalated', 'closed'],
  escalated: ['ready_for_submission', 'resolved', 'closed'],
  resolved: ['closed'],
  rejected: ['closed'],
  blocked: ['closed'],
  closed: [] // Terminal state
};

export interface TransitionContext {
  fromStatus: CaseStatus;
  toStatus: CaseStatus;
  userRole: Role;
  category: IncidentCategory;
  requiresLegalReview: boolean;
}

export function validateStateTransition(ctx: TransitionContext): void {
  const { fromStatus, toStatus, userRole, category, requiresLegalReview } = ctx;

  // 1. Check if source status allows target status in the transition graph
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    throw new StateMachineError(
      `Cannot transition case from '${fromStatus}' to '${toStatus}'. Permitted transitions: [${(allowed || []).join(', ')}]`,
      'INVALID_TRANSITION_PATH'
    );
  }

  // 2. Read-only stakeholder is never allowed to modify state
  if (userRole === 'read_only_stakeholder') {
    throw new StateMachineError(
      'Read-only stakeholder does not possess permission to modify case status.',
      'ROLE_UNAUTHORIZED'
    );
  }

  // 3. Advancing to 'ready_for_submission' requires approval
  if (toStatus === 'ready_for_submission') {
    const isLegalRequired = requiresLegalReview || CATEGORIES_REQUIRING_LEGAL_REVIEW.includes(category);
    if (isLegalRequired) {
      if (userRole !== 'legal_reviewer' && userRole !== 'org_owner' && userRole !== 'system_admin') {
        throw new StateMachineError(
          `Category '${category}' requires mandatory sign-off by a Legal Reviewer or Org Owner before moving to ready_for_submission.`,
          'LEGAL_REVIEW_REQUIRED'
        );
      }
    } else {
      if (userRole === 'analyst') {
        throw new StateMachineError(
          'Analyst cannot mark a case as ready_for_submission; requires Case Manager or Legal Reviewer approval.',
          'ROLE_UNAUTHORIZED'
        );
      }
    }
  }

  // 4. Moving to 'submitted' requires explicit authority and cannot be performed by an Analyst
  if (toStatus === 'submitted') {
    if (fromStatus !== 'ready_for_submission') {
      throw new StateMachineError(
        'Case cannot be submitted without first completing human review and reaching ready_for_submission status.',
        'APPROVAL_GATE_VIOLATION'
      );
    }
    if (userRole === 'analyst') {
      throw new StateMachineError(
        'Analysts are prohibited from dispatching submissions. Submission requires Case Manager, Legal Reviewer, or Org Owner role.',
        'ROLE_UNAUTHORIZED'
      );
    }
  }

  // 5. Reopening or closing cases requires management authority
  if (toStatus === 'closed') {
    if (userRole === 'analyst') {
      throw new StateMachineError(
        'Analysts cannot close cases. Case closure requires Case Manager, Legal Reviewer, or Org Owner role.',
        'ROLE_UNAUTHORIZED'
      );
    }
  }
}
