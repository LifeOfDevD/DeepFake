import { describe, it, expect } from 'vitest';
import {
  validateSubmissionTransition,
  SubmissionStateMachineError
} from '../../src/domain/submission-state-machine.js';

describe('Unit: Submission State Machine & Transition Guards', () => {
  it('allows valid forward progress transitions', () => {
    // draft -> ready_for_review
    expect(() => {
      validateSubmissionTransition({
        fromState: 'draft',
        toState: 'ready_for_review',
        actorUserId: 'usr_mgr_01',
        actorRole: 'case_manager',
        isReadinessPassed: true
      });
    }).not.toThrow();

    // ready_for_review -> approved_for_simulation
    expect(() => {
      validateSubmissionTransition({
        fromState: 'ready_for_review',
        toState: 'approved_for_simulation',
        actorUserId: 'usr_mgr_02',
        actorRole: 'case_manager',
        creatorUserId: 'usr_analyst_01',
        requiredApprovalFacets: ['evidence_sufficiency'],
        approvedFacets: ['evidence_sufficiency'],
        currentPacketHash: 'hash123',
        approvedPacketHash: 'hash123'
      });
    }).not.toThrow();

    // approved_for_simulation -> simulated_submitted
    expect(() => {
      validateSubmissionTransition({
        fromState: 'approved_for_simulation',
        toState: 'simulated_submitted',
        actorUserId: 'usr_mgr_02',
        actorRole: 'case_manager'
      });
    }).not.toThrow();
  });

  it('rejects invalid jump transitions', () => {
    // draft cannot directly jump to simulated_submitted
    expect(() => {
      validateSubmissionTransition({
        fromState: 'draft',
        toState: 'simulated_submitted',
        actorUserId: 'usr_mgr_01',
        actorRole: 'case_manager'
      });
    }).toThrow(SubmissionStateMachineError);

    // closed cannot jump to simulated_submitted
    expect(() => {
      validateSubmissionTransition({
        fromState: 'closed',
        toState: 'simulated_submitted',
        actorUserId: 'usr_mgr_01',
        actorRole: 'case_manager'
      });
    }).toThrow(SubmissionStateMachineError);
  });

  it('blocks transition to ready_for_review if readiness failed', () => {
    expect(() => {
      validateSubmissionTransition({
        fromState: 'draft',
        toState: 'ready_for_review',
        actorUserId: 'usr_mgr_01',
        actorRole: 'case_manager',
        isReadinessPassed: false
      });
    }).toThrowError(/readiness checks have not passed/i);
  });

  it('enforces separation of duties: creator cannot approve submission for simulation', () => {
    expect(() => {
      validateSubmissionTransition({
        fromState: 'ready_for_review',
        toState: 'approved_for_simulation',
        actorUserId: 'usr_creator_01',
        actorRole: 'case_manager',
        creatorUserId: 'usr_creator_01', // SAME USER
        requiredApprovalFacets: ['evidence_sufficiency'],
        approvedFacets: ['evidence_sufficiency'],
        currentPacketHash: 'hash123',
        approvedPacketHash: 'hash123'
      });
    }).toThrowError(/separation of duties violation/i);
  });

  it('blocks transition if packet hash does not match approved packet hash', () => {
    expect(() => {
      validateSubmissionTransition({
        fromState: 'ready_for_review',
        toState: 'approved_for_simulation',
        actorUserId: 'usr_mgr_02',
        actorRole: 'case_manager',
        creatorUserId: 'usr_analyst_01',
        requiredApprovalFacets: ['evidence_sufficiency'],
        approvedFacets: ['evidence_sufficiency'],
        currentPacketHash: 'new_hash_modified_evidence',
        approvedPacketHash: 'old_hash_original'
      });
    }).toThrowError(/packet hash mismatch/i);
  });

  it('blocks transition if deleted or expired evidence exists in packet', () => {
    expect(() => {
      validateSubmissionTransition({
        fromState: 'draft',
        toState: 'ready_for_review',
        actorUserId: 'usr_mgr_01',
        actorRole: 'case_manager',
        hasDeletedEvidence: true
      });
    }).toThrowError(/deleted, quarantined, or expired/i);
  });
});
