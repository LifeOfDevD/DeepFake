import { describe, it, expect } from 'vitest';
import {
  canTransitionEvidence,
  validateEvidenceStateTransition,
  isTerminalEvidenceStatus,
  InvalidEvidenceStateTransitionError,
  TERMINAL_EVIDENCE_STATUSES
} from '../../src/domain/evidence-state-machine.js';
import { EvidenceStatus } from '../../src/domain/types.js';

describe('Domain: Evidence State Machine & Lifecycle Guards', () => {
  const allStatuses: EvidenceStatus[] = [
    'pending',
    'available',
    'quarantined',
    'deletion_requested',
    'deleted',
    'retention_expired',
    'rejected'
  ];

  it('allows valid forward lifecycle transitions', () => {
    // pending -> available, rejected
    expect(canTransitionEvidence('pending', 'available')).toBe(true);
    expect(canTransitionEvidence('pending', 'rejected')).toBe(true);

    // available -> quarantined, deletion_requested, retention_expired
    expect(canTransitionEvidence('available', 'quarantined')).toBe(true);
    expect(canTransitionEvidence('available', 'deletion_requested')).toBe(true);
    expect(canTransitionEvidence('available', 'retention_expired')).toBe(true);

    // quarantined -> available, deletion_requested
    expect(canTransitionEvidence('quarantined', 'available')).toBe(true);
    expect(canTransitionEvidence('quarantined', 'deletion_requested')).toBe(true);

    // deletion_requested -> available (cancelled/rejected), quarantined, deleted (approved)
    expect(canTransitionEvidence('deletion_requested', 'available')).toBe(true);
    expect(canTransitionEvidence('deletion_requested', 'quarantined')).toBe(true);
    expect(canTransitionEvidence('deletion_requested', 'deleted')).toBe(true);
  });

  it('allows reflexive no-op transitions for all states', () => {
    for (const status of allStatuses) {
      expect(canTransitionEvidence(status, status)).toBe(true);
      expect(() => validateEvidenceStateTransition(status, status)).not.toThrow();
    }
  });

  it('identifies terminal statuses correctly', () => {
    expect(TERMINAL_EVIDENCE_STATUSES).toEqual(['deleted', 'retention_expired', 'rejected']);

    for (const status of TERMINAL_EVIDENCE_STATUSES) {
      expect(isTerminalEvidenceStatus(status)).toBe(true);
    }

    expect(isTerminalEvidenceStatus('pending')).toBe(false);
    expect(isTerminalEvidenceStatus('available')).toBe(false);
    expect(isTerminalEvidenceStatus('quarantined')).toBe(false);
    expect(isTerminalEvidenceStatus('deletion_requested')).toBe(false);
  });

  it('strictly forbids any transition out of terminal states', () => {
    for (const terminal of TERMINAL_EVIDENCE_STATUSES) {
      for (const target of allStatuses) {
        if (target === terminal) continue; // reflexive allowed

        expect(canTransitionEvidence(terminal, target)).toBe(false);
        expect(() => validateEvidenceStateTransition(terminal, target)).toThrow(
          InvalidEvidenceStateTransitionError
        );
      }
    }
  });

  it('throws InvalidEvidenceStateTransitionError with informative error details', () => {
    try {
      validateEvidenceStateTransition('deleted', 'available');
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(InvalidEvidenceStateTransitionError);
      expect(err.currentStatus).toBe('deleted');
      expect(err.targetStatus).toBe('available');
      expect(err.message).toContain("cannot transition evidence from 'deleted' to 'available'");
    }
  });

  it('strictly rejects illegal jumps across state boundaries', () => {
    // Cannot jump pending directly to deleted without review or request
    expect(canTransitionEvidence('pending', 'deleted')).toBe(false);
    // Cannot jump available directly to deleted without deletion_requested state
    expect(canTransitionEvidence('available', 'deleted')).toBe(false);
    // Cannot transition available to rejected (rejected is only for pending ingestion)
    expect(canTransitionEvidence('available', 'rejected')).toBe(false);
  });
});
