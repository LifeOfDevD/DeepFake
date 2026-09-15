import { describe, it, expect } from 'vitest';
import { validateStateTransition, StateMachineError } from '../../src/domain/state-machine.js';
import { CaseStatus } from '../../src/domain/types.js';

describe('Domain: Case Lifecycle State Machine', () => {
  it('allows valid sequential forward transitions for Case Manager', () => {
    // new -> triage
    expect(() =>
      validateStateTransition({
        fromStatus: 'new',
        toStatus: 'triage',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // triage -> awaiting_authority
    expect(() =>
      validateStateTransition({
        fromStatus: 'triage',
        toStatus: 'awaiting_authority',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // awaiting_authority -> evidence_collection
    expect(() =>
      validateStateTransition({
        fromStatus: 'awaiting_authority',
        toStatus: 'evidence_collection',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // evidence_collection -> human_review
    expect(() =>
      validateStateTransition({
        fromStatus: 'evidence_collection',
        toStatus: 'human_review',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // human_review -> ready_for_submission (standard category)
    expect(() =>
      validateStateTransition({
        fromStatus: 'human_review',
        toStatus: 'ready_for_submission',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // ready_for_submission -> submitted
    expect(() =>
      validateStateTransition({
        fromStatus: 'ready_for_submission',
        toStatus: 'submitted',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // submitted -> awaiting_response
    expect(() =>
      validateStateTransition({
        fromStatus: 'submitted',
        toStatus: 'awaiting_response',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // awaiting_response -> resolved
    expect(() =>
      validateStateTransition({
        fromStatus: 'awaiting_response',
        toStatus: 'resolved',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();

    // resolved -> closed
    expect(() =>
      validateStateTransition({
        fromStatus: 'resolved',
        toStatus: 'closed',
        userRole: 'case_manager',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).not.toThrow();
  });

  it('prohibits illegal transition shortcuts (e.g. skipping directly from new to submitted)', () => {
    expect(() =>
      validateStateTransition({
        fromStatus: 'new',
        toStatus: 'submitted',
        userRole: 'org_owner',
        category: 'brand_impersonation',
        requiresLegalReview: false
      })
    ).toThrow(StateMachineError);
  });

  it('enforces mandatory Legal Reviewer for synthetic media categories', () => {
    // Case Manager trying to approve synthetic media endorsement must fail
    expect(() =>
      validateStateTransition({
        fromStatus: 'human_review',
        toStatus: 'ready_for_submission',
        userRole: 'case_manager',
        category: 'synthetic_media_endorsement',
        requiresLegalReview: true
      })
    ).toThrow(/requires mandatory sign-off by a Legal Reviewer/);

    // Legal Reviewer approving synthetic media endorsement must succeed
    expect(() =>
      validateStateTransition({
        fromStatus: 'human_review',
        toStatus: 'ready_for_submission',
        userRole: 'legal_reviewer',
        category: 'synthetic_media_endorsement',
        requiresLegalReview: true
      })
    ).not.toThrow();
  });

  it('prevents Analysts from submitting cases', () => {
    expect(() =>
      validateStateTransition({
        fromStatus: 'ready_for_submission',
        toStatus: 'submitted',
        userRole: 'analyst',
        category: 'fake_social_profile',
        requiresLegalReview: false
      })
    ).toThrow(/Analysts are prohibited from dispatching submissions/);
  });

  it('prevents Read-Only Stakeholders from performing any transitions', () => {
    expect(() =>
      validateStateTransition({
        fromStatus: 'new',
        toStatus: 'triage',
        userRole: 'read_only_stakeholder',
        category: 'fake_social_profile',
        requiresLegalReview: false
      })
    ).toThrow(/Read-only stakeholder does not possess permission/);
  });

  it('allows emergency quarantine transition to blocked from any active intake state', () => {
    const intakeStates: CaseStatus[] = ['new', 'triage', 'awaiting_authority', 'evidence_collection', 'human_review'];
    for (const status of intakeStates) {
      expect(() =>
        validateStateTransition({
          fromStatus: status,
          toStatus: 'blocked',
          userRole: 'analyst',
          category: 'privacy_or_likeness_complaint',
          requiresLegalReview: true
        })
      ).not.toThrow();
    }
  });
});
