import { EvidenceStatus } from './types.js';

export class InvalidEvidenceStateTransitionError extends Error {
  constructor(
    public readonly currentStatus: EvidenceStatus,
    public readonly targetStatus: EvidenceStatus,
    message?: string
  ) {
    super(
      message ||
        `Illegal evidence state transition: cannot transition evidence from '${currentStatus}' to '${targetStatus}'.`
    );
    this.name = 'InvalidEvidenceStateTransitionError';
  }
}

export const ALLOWED_EVIDENCE_TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  pending: ['available', 'rejected'],
  available: ['quarantined', 'deletion_requested', 'retention_expired'],
  quarantined: ['available', 'deletion_requested'],
  deletion_requested: ['available', 'quarantined', 'deleted'],
  deleted: [],
  retention_expired: [],
  rejected: []
};

export const TERMINAL_EVIDENCE_STATUSES: EvidenceStatus[] = [
  'deleted',
  'retention_expired',
  'rejected'
];

export function canTransitionEvidence(
  current: EvidenceStatus,
  target: EvidenceStatus
): boolean {
  if (current === target) {
    return true; // No-op transition
  }
  const allowed = ALLOWED_EVIDENCE_TRANSITIONS[current] || [];
  return allowed.includes(target);
}

export function validateEvidenceStateTransition(
  current: EvidenceStatus,
  target: EvidenceStatus
): void {
  if (!canTransitionEvidence(current, target)) {
    throw new InvalidEvidenceStateTransitionError(current, target);
  }
}

export function isTerminalEvidenceStatus(status: EvidenceStatus): boolean {
  return TERMINAL_EVIDENCE_STATUSES.includes(status);
}
