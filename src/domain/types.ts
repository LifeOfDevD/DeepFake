import { z } from 'zod';

// ============================================================================
// INCIDENT CATEGORIES & ROLES
// ============================================================================

export const CaseStatusEnum = z.enum([
  'new',
  'triage',
  'awaiting_authority',
  'evidence_collection',
  'human_review',
  'ready_for_submission',
  'submitted',
  'awaiting_response',
  'escalated',
  'resolved',
  'closed',
  'rejected',
  'blocked' // Excluded / quarantined (CSAM/NCII)
]);
export type CaseStatus = z.infer<typeof CaseStatusEnum>;

export const IncidentCategoryEnum = z.enum([
  'fake_social_profile',
  'brand_impersonation',
  'founder_doctor_creator_impersonation',
  'synthetic_media_endorsement',
  'scam_advertisement',
  'look_alike_domain',
  'fake_support_account',
  'copyright_trademark_misuse',
  'privacy_or_likeness_complaint',
  'defamation_legal_escalation'
]);
export type IncidentCategory = z.infer<typeof IncidentCategoryEnum>;

export const PriorityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type Priority = z.infer<typeof PriorityEnum>;

export const RoleEnum = z.enum([
  'system_admin',
  'org_owner',
  'org_admin',
  'case_manager',
  'analyst',
  'legal_reviewer',
  'read_only_stakeholder'
]);
export type Role = z.infer<typeof RoleEnum>;

// Categories that mandate Legal Reviewer approval before submission
export const CATEGORIES_REQUIRING_LEGAL_REVIEW: IncidentCategory[] = [
  'synthetic_media_endorsement',
  'copyright_trademark_misuse',
  'privacy_or_likeness_complaint',
  'defamation_legal_escalation'
];

// ============================================================================
// ENTITY INTERFACES
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: string;
  jurisdiction: string;
  timezone?: string;
  primary_contact_email: string;
  status?: OrganizationStatus;
  onboarding_checklist?: string | null;
  pilot_settings?: string | null;
  deactivated_at?: string | null;
  deactivated_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  system_role: 'system_admin' | 'user';
  status?: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  organization_id: string;
  role: Role;
  created_at: string;
}

export interface Case {
  id: string;
  organization_id: string;
  case_number: string;
  title: string;
  category: IncidentCategory;
  priority: Priority;
  status: CaseStatus;
  target_entity: string;
  contested_url: string;
  hosting_platform: string;
  reported_by_email: string;
  assigned_to_user_id: string | null;
  requires_legal_review: number; // 0 or 1
  statutory_basis: string; // JSON array of statutory grounds
  // Phase 3 extensions
  target_entity_type?: TargetEntityType;
  affected_jurisdiction?: string;
  urgency?: UrgencyLevel;
  suspected_synthetic_media_type?: SyntheticMediaType;
  impersonation_method?: ImpersonationMethod;
  harm_type?: HarmType;
  involves_intimate_imagery?: number; // 0 or 1
  has_court_or_government_order?: number; // 0 or 1
  court_or_government_order_details?: string | null;
  discovered_at?: string | null;
  reported_by_name?: string | null;
  factual_basis?: string | null;
  operator_notes?: string | null;
  approval_status?: ApprovalState;
  selected_legal_grounds?: string; // JSON array
  declaration_confirmed?: number; // 0 or 1
  declared_at?: string | null;
  normalized_contested_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseStatusHistory {
  id: string;
  case_id: string;
  organization_id: string;
  from_status: CaseStatus;
  to_status: CaseStatus;
  actor_user_id: string;
  actor_email: string;
  reason: string;
  created_at: string;
}

export interface CaseNote {
  id: string;
  case_id: string;
  organization_id: string;
  author_user_id: string;
  author_name: string;
  content: string;
  is_internal_only: number; // 0 or 1
  created_at: string;
}

export interface AuditEvent {
  id: string;
  organization_id: string;
  actor_user_id: string;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string; // JSON string
  ip_address: string;
  created_at: string;
}

// ============================================================================
// API VALIDATION SCHEMAS
// ============================================================================

export const CreateCaseSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(250),
  category: IncidentCategoryEnum,
  priority: PriorityEnum.default('medium'),
  target_entity: z.string().min(2, 'Target entity is required'),
  contested_url: z.string().url('A valid contested URL is required'),
  hosting_platform: z.string().min(2, 'Hosting platform is required'),
  reported_by_email: z.string().email('Valid reporter email is required'),
  assigned_to_user_id: z.string().optional().nullable(),
  statutory_basis: z.array(z.string()).default([])
});
export type CreateCaseInput = z.infer<typeof CreateCaseSchema>;

export const TransitionCaseStatusSchema = z.object({
  to_status: CaseStatusEnum,
  reason: z.string().min(3, 'A reason for the status transition is required')
});
export type TransitionCaseStatusInput = z.infer<typeof TransitionCaseStatusSchema>;

export const CreateCaseNoteSchema = z.object({
  content: z.string().min(2, 'Note content cannot be empty'),
  is_internal_only: z.boolean().default(true)
});
export type CreateCaseNoteInput = z.infer<typeof CreateCaseNoteSchema>;

export const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  industry: z.string().min(2),
  jurisdiction: z.string().default('IN-DL'),
  timezone: z.string().default('Asia/Kolkata'),
  primary_contact_email: z.string().email()
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

export const InviteUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: RoleEnum
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

// ============================================================================
// PHASE 2: EVIDENCE TYPES & SCHEMAS
// ============================================================================

export const EvidenceStatusEnum = z.enum([
  'pending',
  'available',
  'quarantined',
  'rejected',
  'deletion_requested',
  'deleted',
  'retention_expired'
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusEnum>;

export const EvidenceSensitivityEnum = z.enum([
  'normal',
  'sensitive',
  'restricted',
  'prohibited'
]);
export type EvidenceSensitivity = z.infer<typeof EvidenceSensitivityEnum>;

export const EvidenceTypeEnum = z.enum([
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'screenshot',
  'source_url',
  'note'
]);
export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;

export interface EvidenceItem {
  id: string;
  organization_id: string;
  case_id: string;
  evidence_type: EvidenceType;
  original_filename: string;
  safe_display_name: string;
  mime_type: string;
  detected_mime_type: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  status: EvidenceStatus;
  sensitivity: EvidenceSensitivity;
  source_url: string | null;
  captured_at: string;
  uploaded_at: string;
  uploaded_by: string;
  retention_until: string;
  legal_hold: number; // 0 or 1
  deleted_at: string | null;
  deletion_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceAccessEvent {
  id: string;
  organization_id: string;
  evidence_id: string;
  actor_user_id: string;
  action: string;
  success: number;
  ip_address: string;
  user_agent: string;
  created_at: string;
  metadata_json: string;
}

export interface EvidenceRetentionHold {
  id: string;
  organization_id: string;
  evidence_id: string;
  created_by: string;
  reason: string;
  created_at: string;
  released_by: string | null;
  released_at: string | null;
}

export const CreateSourceUrlEvidenceSchema = z.object({
  source_url: z.string().url('A valid URL is required').max(2048, 'URL must not exceed 2048 characters'),
  safe_display_name: z.string().min(2, 'Display name is required').max(200),
  operator_notes: z.string().optional().default(''),
  sensitivity: EvidenceSensitivityEnum.default('normal')
});
export type CreateSourceUrlEvidenceInput = z.infer<typeof CreateSourceUrlEvidenceSchema>;

export const MarkSensitivitySchema = z.object({
  sensitivity: EvidenceSensitivityEnum,
  reason: z.string().min(3, 'A reason for changing sensitivity is required')
});
export type MarkSensitivityInput = z.infer<typeof MarkSensitivitySchema>;

export const QuarantineEvidenceSchema = z.object({
  reason: z.string().min(3, 'A justification for quarantine is required')
});
export type QuarantineEvidenceInput = z.infer<typeof QuarantineEvidenceSchema>;

export const PlaceLegalHoldSchema = z.object({
  reason: z.string().min(3, 'A legal hold justification is required')
});
export type PlaceLegalHoldInput = z.infer<typeof PlaceLegalHoldSchema>;

export const ReleaseLegalHoldSchema = z.object({
  reason: z.string().min(3, 'A reason for releasing the legal hold is required')
});
export type ReleaseLegalHoldInput = z.infer<typeof ReleaseLegalHoldSchema>;

export const DeletionRequestSchema = z.object({
  reason: z.string().min(3, 'A reason for the deletion request is required')
});
export type DeletionRequestInput = z.infer<typeof DeletionRequestSchema>;

export const ApproveDeletionSchema = z.object({
  reason: z.string().min(3, 'An approval reason for deletion is required')
});
export type ApproveDeletionInput = z.infer<typeof ApproveDeletionSchema>;

export const RejectDeletionRequestSchema = z.object({
  reason: z.string().min(3, 'A rejection reason is required')
});
export type RejectDeletionRequestInput = z.infer<typeof RejectDeletionRequestSchema>;

export type DeletionRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface EvidenceDeletionRequest {
  id: string;
  organization_id: string;
  evidence_id: string;
  case_id: string;
  requested_by: string;
  request_reason: string;
  requested_at: string;
  status: DeletionRequestStatus;
  reviewed_by: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadTokenPayload {
  evidenceId: string;
  organizationId: string;
  actorUserId: string;
  expiresAt: number;
}

// ============================================================================
// PHASE 3: INCIDENT INTAKE, TRIAGE, STATUTORY CLOCKS & WORKFLOW TYPES
// ============================================================================

export const TargetEntityTypeEnum = z.enum([
  'individual_professional',
  'brand_or_organization',
  'creator_or_public_figure',
  'executive'
]);
export type TargetEntityType = z.infer<typeof TargetEntityTypeEnum>;

export const UrgencyLevelEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type UrgencyLevel = z.infer<typeof UrgencyLevelEnum>;

export const SyntheticMediaTypeEnum = z.enum([
  'none',
  'audio_clone',
  'face_swap_video',
  'lip_sync_deepfake',
  'ai_generated_image',
  'text_ai_profile',
  'multimodal_composite'
]);
export type SyntheticMediaType = z.infer<typeof SyntheticMediaTypeEnum>;

export const ImpersonationMethodEnum = z.enum([
  'profile_cloning',
  'fake_account',
  'hacked_account',
  'synthetic_content',
  'unauthorized_association',
  'domain_spoofing'
]);
export type ImpersonationMethod = z.infer<typeof ImpersonationMethodEnum>;

export const HarmTypeEnum = z.enum([
  'reputational',
  'financial_fraud',
  'harassment',
  'privacy_violation',
  'trademark_infringement',
  'medical_misinformation',
  'extortion'
]);
export type HarmType = z.infer<typeof HarmTypeEnum>;

export const ApprovalStateEnum = z.enum([
  'draft',
  'triage_complete',
  'awaiting_legal_review',
  'legal_review_approved',
  'ready_for_submission',
  'submission_simulated',
  'rejected',
  'blocked'
]);
export type ApprovalState = z.infer<typeof ApprovalStateEnum>;

export const TriageClassificationEnum = z.enum([
  'standard_impersonation',
  'synthetic_media_impersonation',
  'fake_endorsement_or_commercial_misuse',
  'non_consensual_intimate_imagery',
  'privacy_or_likeness_complaint',
  'copyright_or_trademark_complaint',
  'defamation_or_legal_escalation',
  'unknown_needs_human_review'
]);
export type TriageClassification = z.infer<typeof TriageClassificationEnum>;

export const ClockStatusEnum = z.enum([
  'not_started',
  'running',
  'paused',
  'due_soon',
  'overdue',
  'completed',
  'cancelled'
]);
export type ClockStatus = z.infer<typeof ClockStatusEnum>;

export const TaskTypeEnum = z.enum([
  'missing_evidence',
  'legal_review_required',
  'deadline_due_soon',
  'overdue_escalation',
  'duplicate_incident_review',
  'packet_approval_required',
  'retention_or_evidence_issue'
]);
export type TaskType = z.infer<typeof TaskTypeEnum>;

export const TaskPriorityEnum = z.enum(['p1', 'p2', 'p3', 'p4']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskStatusEnum = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

// Structured Incident Intake Schema with Strict Legal Guardrails
export const IncidentIntakeSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(250),
  category: IncidentCategoryEnum,
  priority: PriorityEnum.default('medium'),
  urgency: UrgencyLevelEnum.default('medium'),
  target_entity: z.string().min(2, 'Target person, brand, or professional is required'),
  target_entity_type: TargetEntityTypeEnum.default('individual_professional'),
  contested_url: z.string().url('A valid contested URL is required'),
  hosting_platform: z.string().min(2, 'Hosting platform is required'),
  affected_jurisdiction: z.string().default('IN-National'),
  reported_by_name: z.string().min(2, 'Reporter name is required'),
  reported_by_email: z.string().email('Valid reporter email is required'),
  assigned_to_user_id: z.string().optional().nullable(),
  discovered_at: z.string().datetime({ message: 'Valid ISO timestamp required for discovery time' }).optional(),
  suspected_synthetic_media_type: SyntheticMediaTypeEnum.default('none'),
  impersonation_method: ImpersonationMethodEnum.default('profile_cloning'),
  harm_type: HarmTypeEnum.default('reputational'),
  involves_intimate_imagery: z.boolean().default(false),
  has_court_or_government_order: z.boolean().default(false),
  court_or_government_order_details: z.string().optional().nullable(),
  factual_basis: z.string().optional().nullable(),
  operator_notes: z.string().optional().nullable(),
  statutory_basis: z.array(z.string()).default([]),
  selected_legal_grounds: z.array(z.string()).default([]),
  declaration_confirmed: z.boolean().default(false)
}).superRefine((data, ctx) => {
  // Legal Guardrail 1: Defamation claims MUST have factual basis and mandatory legal review
  if (data.category === 'defamation_legal_escalation') {
    if (!data.factual_basis || data.factual_basis.trim().length < 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['factual_basis'],
        message: 'Defamation claims require detailed factual basis narrative (minimum 15 characters).'
      });
    }
  }

  // Legal Guardrail 2: Court or government orders require specific order details
  if (data.has_court_or_government_order) {
    if (!data.court_or_government_order_details || data.court_or_government_order_details.trim().length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['court_or_government_order_details'],
        message: 'Must provide court/government order details (court name, case/order number, and date).'
      });
    }
  }
});
export type IncidentIntakeInput = z.infer<typeof IncidentIntakeSchema>;

export interface CaseTriageRecord {
  id: string;
  case_id: string;
  organization_id: string;
  classification: TriageClassification;
  confidence: 'high' | 'medium' | 'low';
  triggered_rules: string[];
  actor_or_component: string;
  requires_human_review: number; // 0 or 1
  notes?: string;
  created_at: string;
}

export const DeadlineTypeEnum = z.enum([
  'legally_mandatory',
  'contractual',
  'platform_policy',
  'internal_sla'
]);
export type DeadlineType = z.infer<typeof DeadlineTypeEnum>;

export interface StatutoryClock {
  id: string;
  case_id: string;
  organization_id: string;
  incident_discovered_at: string;
  complaint_created_at: string;
  acknowledgement_deadline: string;
  submission_deadline: string;
  escalation_deadline: string;
  current_status: ClockStatus;
  paused_reason?: string | null;
  operational_basis: string;
  source_note?: string | null;
  timezone: string;
  court_order_evidence?: string | null;
  operational_rule?: string;
  jurisdiction?: string;
  source_citation?: string;
  source_url_or_identifier?: string;
  effective_date?: string;
  last_verified_date?: string;
  deadline_type?: DeadlineType;
  created_at: string;
  updated_at: string;
}

export interface ClockEvaluation {
  clock: StatutoryClock;
  acknowledgement_remaining_hours: number;
  submission_remaining_hours: number;
  escalation_remaining_hours: number;
  is_due_soon: boolean; // <= 24h
  is_urgent: boolean;   // <= 3h
  is_overdue: boolean;  // <= 0h
  warnings: string[];
  operational_rule?: string;
  jurisdiction?: string;
  source_citation?: string;
  deadline_type?: DeadlineType;
}

export interface MissingRequirement {
  code: string;
  message: string;
  severity: 'blocking' | 'warning';
  field?: string;
}

export interface CaseReadinessResult {
  case_id: string;
  is_ready: boolean;
  passed_checks: string[];
  missing_requirements: MissingRequirement[];
  evaluated_at: string;
}

export interface EvidenceManifestItem {
  evidence_id: string;
  safe_display_name: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
  captured_at: string;
  storage_key_obscured: string;
}

export interface SubmissionPacketPayload {
  packet_version: number;
  mode: 'DRY_RUN_ONLY_SIMULATION';
  generated_at: string;
  organization_id: string;
  case_id: string;
  case_number: string;
  title: string;
  affected_party: {
    target_entity: string;
    target_entity_type: string;
    reported_by_name?: string;
    reported_by_email: string;
    jurisdiction: string;
  };
  incident_details: {
    hosting_platform: string;
    contested_url: string;
    category: string;
    triage_classification?: string;
    suspected_synthetic_media_type: string;
    impersonation_method: string;
    harm_type: string;
    discovered_at?: string;
    factual_basis?: string;
  };
  statutory_grounds: {
    statutory_basis: string[];
    selected_legal_grounds: string[];
    has_court_or_government_order: boolean;
    court_or_government_order_details?: string;
    operational_basis?: string;
  };
  evidence_manifest: EvidenceManifestItem[];
  chain_of_custody_summary: {
    item_count: number;
    total_bytes: number;
    custody_verified: boolean;
  };
  requested_action: string;
  reporter_declaration: string;
  approval_status: string;
  internal_warnings: string[];
}

export interface SubmissionPacket {
  id: string;
  case_id: string;
  organization_id: string;
  packet_version: number;
  status: 'dry_run_generated' | 'approved' | 'simulated';
  packet_hash: string;
  packet_json: string;
  packet_markdown: string;
  evidence_manifest_json: string;
  generated_by: string;
  approved_by?: string | null;
  simulated_at?: string | null;
  created_at: string;
}

export interface CaseApprovalRecord {
  id: string;
  case_id: string;
  organization_id: string;
  approval_type: string;
  action: 'approved' | 'rejected' | 'blocked';
  decided_by: string;
  decision_reason: string;
  from_approval_state: ApprovalState;
  to_approval_state: ApprovalState;
  created_at: string;
}

export interface WorkflowTask {
  id: string;
  case_id: string;
  organization_id: string;
  task_type: TaskType;
  priority: TaskPriority;
  due_at?: string | null;
  assigned_role: Role;
  assigned_user_id?: string | null;
  status: TaskStatus;
  creation_reason: string;
  completion_reason?: string | null;
  completed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DuplicateCaseLink {
  id: string;
  organization_id: string;
  source_case_id: string;
  matched_case_id: string;
  match_reason: string;
  similarity_score: number;
  status: 'pending_review' | 'confirmed_duplicate' | 'dismissed';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

// ============================================================================
// PHASE 4: PLATFORM GRIEVANCE OPERATIONS, SUBMISSIONS, ESCALATIONS & RE-UPLOADS
// ============================================================================

export const SubmissionStatusEnum = z.enum([
  'draft',
  'needs_information',
  'ready_for_review',
  'approved_for_simulation',
  'simulated_submitted',
  'acknowledged',
  'response_received',
  'action_taken',
  'rejected',
  'escalation_required',
  'closed'
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusEnum>;

export const ApprovalFacetEnum = z.enum([
  'legal_sufficiency',
  'evidence_sufficiency',
  'platform_route_selection',
  'simulated_submission'
]);
export type ApprovalFacet = z.infer<typeof ApprovalFacetEnum>;

export const TakedownResultEnum = z.enum([
  'pending',
  'removed',
  'geoblocked_india_only',
  'demoted_or_labeled',
  'no_action',
  'account_suspended'
]);
export type TakedownResult = z.infer<typeof TakedownResultEnum>;

export const PlatformResponseCategoryEnum = z.enum([
  'takedown_completed',
  'content_not_found',
  'insufficient_evidence',
  'not_violating_policy',
  'counter_notice_received',
  'appeal_suggested',
  'escalated_internally',
  'acknowledged_pending_review'
]);
export type PlatformResponseCategory = z.infer<typeof PlatformResponseCategoryEnum>;

export const EscalationTriggerEnum = z.enum([
  'no_acknowledgement',
  'no_response',
  'platform_rejection',
  'repeated_reupload',
  'incorrect_complaint_route',
  'missing_evidence',
  'suspected_legal_risk',
  'court_or_government_order_required',
  'human_review_required'
]);
export type EscalationTrigger = z.infer<typeof EscalationTriggerEnum>;

export const EscalationSeverityEnum = z.enum(['p1', 'p2', 'p3']);
export type EscalationSeverity = z.infer<typeof EscalationSeverityEnum>;

export const EscalationRecommendationEnum = z.enum([
  'gac_appeal_rule_3a',
  'cybercrime_ncrp_filing',
  'commercial_court_injunction',
  'nodal_officer_escalation',
  'gather_additional_evidence',
  'switch_complaint_route'
]);
export type EscalationRecommendation = z.infer<typeof EscalationRecommendationEnum>;

export const EscalationResolutionStatusEnum = z.enum([
  'open',
  'investigating',
  'action_recommended',
  'resolved',
  'dismissed'
]);
export type EscalationResolutionStatus = z.infer<typeof EscalationResolutionStatusEnum>;

export const RelatedContentRelationshipEnum = z.enum([
  'same_content',
  'modified_reupload',
  'mirror',
  'related_account',
  'successor_url',
  'suspected_duplicate'
]);
export type RelatedContentRelationship = z.infer<typeof RelatedContentRelationshipEnum>;

export const RelatedContentStatusEnum = z.enum(['suspected', 'confirmed', 'dismissed']);
export type RelatedContentStatus = z.infer<typeof RelatedContentStatusEnum>;

export interface PlatformRegistryItem {
  id: string;
  name: string;
  slug: string;
  domain: string;
  country_or_jurisdiction: string;
  supported_complaint_categories: string[];
  impersonation_policy_url?: string | null;
  privacy_or_ncii_policy_url?: string | null;
  copyright_trademark_policy_url?: string | null;
  grievance_contact_route: string;
  required_fields: string[];
  accepted_evidence_types: string[];
  max_attachment_size_mb: number;
  supported_languages: string[];
  expected_acknowledgement_window_hours: number;
  expected_response_window_hours: number;
  escalation_route: string;
  last_verified_at: string;
  verification_source: string;
  is_active: number;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface PlatformPolicyVersion {
  id: string;
  platform_id: string;
  version_number: number;
  policy_type: string;
  policy_url: string;
  effective_date: string;
  summary_of_terms: string;
  created_by: string;
  created_at: string;
}

export interface PlatformPlaybook {
  id: string;
  slug: string;
  title: string;
  description: string;
  incident_category: IncidentCategory;
  applicable_platforms: string[];
  required_intake_fields: string[];
  required_evidence_types: string[];
  recommended_factual_language: string;
  prohibited_unsupported_assertions: string[];
  declaration_requirements: string[];
  requires_legal_review: number;
  escalation_rules: string[];
  expected_response_clock_type: string;
  expected_response_window_hours: number;
  packet_template_markdown: string;
  human_approval_requirements: string[];
  version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SubmissionEntity {
  id: string;
  case_id: string;
  organization_id: string;
  platform_id: string;
  playbook_id: string;
  status: SubmissionStatus;
  packet_version: number;
  packet_hash: string;
  packet_payload_json: string;
  packet_markdown: string;
  simulated_reference_id?: string | null;
  simulated_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SubmissionTransitionRecord {
  id: string;
  submission_id: string;
  organization_id: string;
  from_state: SubmissionStatus;
  to_state: SubmissionStatus;
  actor_user_id: string;
  actor_role: Role;
  reason: string;
  packet_hash: string;
  created_at: string;
}

export interface SubmissionApprovalRecord {
  id: string;
  submission_id: string;
  organization_id: string;
  approval_facet: ApprovalFacet;
  packet_hash: string;
  packet_version: number;
  decided_by: string;
  decided_role: Role;
  decision: 'approved' | 'rejected';
  decision_reason: string;
  is_superseded: number;
  created_at: string;
}

export interface SubmissionResponseRecord {
  id: string;
  submission_id: string;
  platform_id: string;
  organization_id: string;
  acknowledgement_received_at?: string | null;
  response_received_at?: string | null;
  platform_reference_number?: string | null;
  response_category: PlatformResponseCategory;
  requested_additional_information?: string | null;
  takedown_result: TakedownResult;
  rejection_reason?: string | null;
  escalation_required: number;
  operator_notes?: string | null;
  attached_evidence_ids: string[];
  recorded_by: string;
  created_at: string;
}

export interface CaseEscalationRecord {
  id: string;
  case_id: string;
  submission_id?: string | null;
  organization_id: string;
  trigger_type: EscalationTrigger;
  severity: EscalationSeverity;
  assigned_owner_id?: string | null;
  due_at?: string | null;
  recommended_next_action: EscalationRecommendation;
  supporting_evidence_ids: string[];
  resolution_status: EscalationResolutionStatus;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RelatedContentObservationRecord {
  id: string;
  case_id: string;
  organization_id: string;
  observed_url: string;
  normalized_url: string;
  platform_id?: string | null;
  target_entity: string;
  content_hash?: string | null;
  relationship: RelatedContentRelationship;
  similarity_score: number;
  operator_notes?: string | null;
  status: RelatedContentStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Schemas for Phase 4 API Validation
export const CreateSubmissionSchema = z.object({
  case_id: z.string().min(1, 'Case ID is required'),
  platform_id: z.string().min(1, 'Platform ID is required'),
  playbook_id: z.string().min(1, 'Playbook ID is required')
});
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionSchema>;

export const ApproveSubmissionFacetSchema = z.object({
  approval_facet: ApprovalFacetEnum,
  decision: z.enum(['approved', 'rejected']),
  decision_reason: z.string().min(3, 'Substantive justification (minimum 3 characters) is required'),
  packet_hash: z.string().min(64, 'Expected SHA-256 packet hash is required')
});
export type ApproveSubmissionFacetInput = z.infer<typeof ApproveSubmissionFacetSchema>;

export const RecordAcknowledgementSchema = z.object({
  platform_reference_number: z.string().min(2, 'Platform reference number or ticket ID is required'),
  acknowledgement_received_at: z.string().datetime({ message: 'Valid ISO timestamp required' }).optional(),
  operator_notes: z.string().optional().nullable()
});
export type RecordAcknowledgementInput = z.infer<typeof RecordAcknowledgementSchema>;

export const RecordPlatformDecisionSchema = z.object({
  response_category: PlatformResponseCategoryEnum,
  takedown_result: TakedownResultEnum,
  platform_reference_number: z.string().optional().nullable(),
  response_received_at: z.string().datetime({ message: 'Valid ISO timestamp required' }).optional(),
  requested_additional_information: z.string().optional().nullable(),
  rejection_reason: z.string().optional().nullable(),
  escalation_required: z.boolean().default(false),
  operator_notes: z.string().optional().nullable(),
  attached_evidence_ids: z.array(z.string()).default([])
});
export type RecordPlatformDecisionInput = z.infer<typeof RecordPlatformDecisionSchema>;

export const CreateEscalationSchema = z.object({
  case_id: z.string().min(1, 'Case ID is required'),
  submission_id: z.string().optional().nullable(),
  trigger_type: EscalationTriggerEnum,
  severity: EscalationSeverityEnum.default('p2'),
  recommended_next_action: EscalationRecommendationEnum,
  assigned_owner_id: z.string().optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
  supporting_evidence_ids: z.array(z.string()).default([]),
  notes: z.string().optional().nullable()
});
export type CreateEscalationInput = z.infer<typeof CreateEscalationSchema>;

export const ResolveEscalationSchema = z.object({
  resolution_status: z.enum(['action_recommended', 'resolved', 'dismissed']),
  resolution_notes: z.string().min(5, 'Substantive resolution notes are required')
});
export type ResolveEscalationInput = z.infer<typeof ResolveEscalationSchema>;

export const AddRelatedContentSchema = z.object({
  case_id: z.string().min(1, 'Case ID is required'),
  observed_url: z.string().url('A valid observed URL is required'),
  platform_id: z.string().optional().nullable(),
  target_entity: z.string().min(2, 'Target entity is required'),
  relationship: RelatedContentRelationshipEnum,
  similarity_score: z.number().min(0).max(1).default(1.0),
  operator_notes: z.string().optional().nullable(),
  status: RelatedContentStatusEnum.default('suspected')
});
export type AddRelatedContentInput = z.infer<typeof AddRelatedContentSchema>;

export const UpdateRelatedContentStatusSchema = z.object({
  status: RelatedContentStatusEnum,
  operator_notes: z.string().optional().nullable()
});
export type UpdateRelatedContentStatusInput = z.infer<typeof UpdateRelatedContentStatusSchema>;

export const AddPlatformPolicySchema = z.object({
  policy_type: z.string().min(2),
  policy_url: z.string().url(),
  effective_date: z.string().min(4),
  summary_of_terms: z.string().min(10)
});
export type AddPlatformPolicyInput = z.infer<typeof AddPlatformPolicySchema>;

// ============================================================================
// Phase 5: Onboarding, Entitlements, Metering, Billing, & Notifications Types
// ============================================================================

export const OrganizationStatusEnum = z.enum(['onboarding', 'active', 'suspended', 'deactivated']);
export type OrganizationStatus = z.infer<typeof OrganizationStatusEnum>;

export interface OnboardingChecklist {
  profile_complete: boolean;
  owner_assigned: boolean;
  legal_reviewer_assigned: boolean;
  retention_configured: boolean;
  playbook_acknowledged: boolean;
  terms_accepted: boolean;
  test_case_completed: boolean;
}

export const InvitationStatusEnum = z.enum(['pending', 'accepted', 'rejected', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof InvitationStatusEnum>;

export interface OrganizationInvitationRecord {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by_user_id: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at?: string | null;
  created_at: string;
  updated_at: string;
}



export const CreateInvitationSchema = z.object({
  email: z.string().email('Valid recipient email is required'),
  role: RoleEnum
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

export const AcceptInvitationSchema = z.object({
  token: z.string().min(16, 'Valid invitation token is required'),
  full_name: z.string().min(2, 'Full name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;

export const PlanTierEnum = z.enum(['pilot', 'professional', 'enterprise']);
export type PlanTier = z.infer<typeof PlanTierEnum>;

export interface PilotEntitlementsRecord {
  id: string;
  organization_id: string;
  plan_tier: PlanTier;
  pilot_start_date: string;
  pilot_end_date: string;
  enabled_features: string[];
  max_users: number;
  max_active_cases: number;
  max_monthly_evidence_uploads: number;
  max_storage_bytes: number;
  max_simulated_submissions_per_month: number;
  max_monitored_subjects?: number;
  max_monthly_monitoring_signals?: number;
  created_at: string;
  updated_at: string;
}

export const UpdateEntitlementsSchema = z.object({
  plan_tier: PlanTierEnum.optional(),
  pilot_end_date: z.string().datetime().optional(),
  enabled_features: z.array(z.string()).optional(),
  max_users: z.number().int().positive().optional(),
  max_active_cases: z.number().int().positive().optional(),
  max_monthly_evidence_uploads: z.number().int().positive().optional(),
  max_storage_bytes: z.number().int().positive().optional(),
  max_simulated_submissions_per_month: z.number().int().positive().optional(),
  max_monitored_subjects: z.number().int().positive().optional(),
  max_monthly_monitoring_signals: z.number().int().positive().optional()
});
export type UpdateEntitlementsInput = z.infer<typeof UpdateEntitlementsSchema>;

export const UsageEventTypeEnum = z.enum([
  'case_created',
  'evidence_uploaded',
  'evidence_bytes_stored',
  'evidence_downloaded',
  'packet_generated',
  'submission_simulated',
  'response_recorded',
  'task_created',
  'task_completed',
  'user_active',
  'monitoring_signal_ingested',
  'candidate_evaluated'
]);
export type UsageEventType = z.infer<typeof UsageEventTypeEnum>;

export interface UsageEventRecord {
  id: string;
  organization_id: string;
  event_type: UsageEventType;
  quantity: number;
  idempotency_key: string;
  resource_id?: string | null;
  actor_user_id?: string | null;
  metadata?: string | null;
  recorded_at: string;
}

export interface UsageDailyAggregateRecord {
  id: string;
  organization_id: string;
  date: string;
  event_type: UsageEventType;
  total_quantity: number;
  updated_at: string;
}

export const RecordUsageAdjustmentSchema = z.object({
  event_type: UsageEventTypeEnum,
  quantity_delta: z.number(),
  reason: z.string().min(5, 'Substantive justification for manual usage adjustment required')
});
export type RecordUsageAdjustmentInput = z.infer<typeof RecordUsageAdjustmentSchema>;

// Billing Domain Interfaces (Dry-Run Only)
export interface BillingCustomerInput {
  organizationId: string;
  name: string;
  email: string;
  jurisdiction: string;
}

export interface BillingCustomer {
  customerId: string;
  organizationId: string;
  name: string;
  email: string;
  mode: 'DRY_RUN';
  createdAt: string;
}

export interface BillingSubscriptionInput {
  organizationId: string;
  customerId: string;
  planTier: PlanTier;
}

export interface BillingSubscription {
  subscriptionId: string;
  customerId: string;
  organizationId: string;
  planTier: PlanTier;
  status: 'active' | 'trialing' | 'canceled';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  mode: 'DRY_RUN';
}

export interface InvoicePreviewInput {
  organizationId: string;
  monthString?: string; // YYYY-MM
}

export interface InvoiceItemLine {
  description: string;
  quantity: number;
  unitPriceInr: number;
  amountInr: number;
  isOverage: boolean;
}

export interface InvoicePreview {
  invoiceNumber: string;
  organizationId: string;
  organizationName: string;
  periodStart: string;
  periodEnd: string;
  planTier: PlanTier;
  subtotalInr: number;
  gstInr: number; // 18% GST in India
  totalInr: number;
  lineItems: InvoiceItemLine[];
  overageWarnings: string[];
  mode: 'DRY_RUN_SIMULATION_ONLY';
  watermark: string;
  generatedAt: string;
}

// Notification Outbox
export const NotificationTypeEnum = z.enum([
  'invitation',
  'case_assigned',
  'clock_due_soon',
  'clock_overdue',
  'legal_review_required',
  'submission_approval_required',
  'platform_ack_missing',
  'escalation_created',
  'evidence_retention_approaching',
  'usage_threshold_reached',
  'candidate_review_required',
  'monitoring_alert_triggered',
  'monitoring_quota_exceeded'
]);
export type NotificationType = z.infer<typeof NotificationTypeEnum>;

export interface NotificationOutboxRecord {
  id: string;
  organization_id: string;
  recipient_user_id?: string | null;
  recipient_role?: Role | null;
  recipient_email: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  payload?: string | null;
  status: 'pending' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
  idempotency_key: string;
  delivery_channel: 'in_app' | 'console' | 'file' | 'dry_run';
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InAppNotificationRecord {
  id: string;
  organization_id: string;
  user_id: string;
  notification_outbox_id?: string | null;
  title: string;
  body: string;
  notification_type: NotificationType;
  is_read: number;
  read_at?: string | null;
  created_at: string;
}

export interface WorkerHeartbeatRecord {
  worker_name: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  last_heartbeat_at: string;
  last_run_duration_ms?: number | null;
  iteration_count: number;
  error_count: number;
  last_error?: string | null;
  metadata?: string | null;
}

export const ReportTypeEnum = z.enum([
  'open_cases',
  'statutory_clocks_overdue',
  'active_escalations',
  'evidence_inventory',
  'retention_schedule',
  'submission_simulation_history',
  'response_outcomes',
  'usage_summary',
  'audit_timeline'
]);
export type ReportType = z.infer<typeof ReportTypeEnum>;

export const GenerateReportSchema = z.object({
  report_type: ReportTypeEnum,
  format: z.enum(['json', 'csv']).default('json'),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional()
});
export type GenerateReportInput = z.infer<typeof GenerateReportSchema>;

// ============================================================================
// PHASE 6: AUTOMATED MONITORING, DETECTION INTAKE & CANDIDATE CORRELATION
// ============================================================================

export const SubjectTypeEnum = z.enum([
  'individual',
  'executive',
  'doctor',
  'creator',
  'brand',
  'organization'
]);
export type SubjectType = z.infer<typeof SubjectTypeEnum>;

export const MonitoringStatusEnum = z.enum([
  'draft',
  'pending_authorization',
  'active',
  'paused',
  'suspended',
  'archived'
]);
export type MonitoringStatus = z.infer<typeof MonitoringStatusEnum>;

export const AuthorizationBasisEnum = z.enum([
  'direct_mandate',
  'representation_agreement',
  'power_of_attorney',
  'employment_authorization',
  'legal_counsel_mandate'
]);
export type AuthorizationBasis = z.infer<typeof AuthorizationBasisEnum>;

export const SubjectSensitivityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type SubjectSensitivity = z.infer<typeof SubjectSensitivityEnum>;

export const EnrollmentStatusEnum = z.enum(['not_enrolled', 'enrolled', 'disabled']);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusEnum>;

export const ReferenceMediaMetadataSchema = z.object({
  id: z.string(),
  media_type: z.enum(['image', 'audio']),
  sha256_hash: z.string().min(64).max(64),
  file_name: z.string(),
  mime_type: z.string(),
  dimension_or_duration: z.string().optional(),
  recorded_at: z.string()
});
export type ReferenceMediaMetadata = z.infer<typeof ReferenceMediaMetadataSchema>;

export interface MonitoredSubject {
  id: string;
  organization_id: string;
  subject_type: SubjectType;
  canonical_name: string;
  aliases: string[];
  handles: string[];
  official_domains: string[];
  official_social_urls: string[];
  reference_images_metadata: ReferenceMediaMetadata[];
  reference_audio_metadata: ReferenceMediaMetadata[];
  voice_enrollment_status: EnrollmentStatus;
  face_enrollment_status: EnrollmentStatus;
  monitoring_status: MonitoringStatus;
  authorization_basis: AuthorizationBasis;
  authorization_reference: string;
  jurisdiction: string;
  sensitivity: SubjectSensitivity;
  retention_policy_days: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export const CreateSubjectSchema = z.object({
  subject_type: SubjectTypeEnum,
  canonical_name: z.string().min(2).max(255),
  aliases: z.array(z.string()).default([]),
  handles: z.array(z.string()).default([]),
  official_domains: z.array(z.string()).default([]),
  official_social_urls: z.array(z.string().url()).default([]),
  reference_images_metadata: z.array(ReferenceMediaMetadataSchema).default([]),
  reference_audio_metadata: z.array(ReferenceMediaMetadataSchema).default([]),
  voice_enrollment_status: EnrollmentStatusEnum.default('not_enrolled'),
  face_enrollment_status: EnrollmentStatusEnum.default('not_enrolled'),
  monitoring_status: MonitoringStatusEnum.default('draft'),
  authorization_basis: AuthorizationBasisEnum,
  authorization_reference: z.string().min(3),
  jurisdiction: z.string().default('IN'),
  sensitivity: SubjectSensitivityEnum.default('medium'),
  retention_policy_days: z.number().int().min(1).max(3650).default(90)
});
export type CreateSubjectInput = z.infer<typeof CreateSubjectSchema>;

export const UpdateSubjectSchema = CreateSubjectSchema.partial();
export type UpdateSubjectInput = z.infer<typeof UpdateSubjectSchema>;

export const ScanScheduleEnum = z.enum(['hourly', 'daily', 'continuous', 'manual']);
export type ScanSchedule = z.infer<typeof ScanScheduleEnum>;

export interface MonitoringPolicy {
  id: string;
  organization_id: string;
  subject_id: string;
  name: string;
  enabled_signal_types: string[];
  enabled_adapters: string[];
  scan_schedule: ScanSchedule;
  max_monthly_candidate_volume: number;
  alert_threshold: number;
  auto_link_threshold: number;
  human_review_threshold: number;
  retention_days: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export const CreateMonitoringPolicySchema = z.object({
  subject_id: z.string(),
  name: z.string().min(2).max(255),
  enabled_signal_types: z.array(z.string()).default(['profile', 'post', 'video']),
  enabled_adapters: z.array(z.string()).default(['manual_intake', 'file_replay', 'inbound_webhook', 'local_fixture']),
  scan_schedule: ScanScheduleEnum.default('hourly'),
  max_monthly_candidate_volume: z.number().int().min(1).max(10000).default(100),
  alert_threshold: z.number().min(0).max(1).default(0.7),
  auto_link_threshold: z.number().min(0).max(1).default(0.85),
  human_review_threshold: z.number().min(0).max(1).default(0.3),
  retention_days: z.number().int().min(1).max(3650).default(90),
  is_active: z.number().int().min(0).max(1).default(1)
});
export type CreateMonitoringPolicyInput = z.infer<typeof CreateMonitoringPolicySchema>;

export const UpdateMonitoringPolicySchema = CreateMonitoringPolicySchema.partial();
export type UpdateMonitoringPolicyInput = z.infer<typeof UpdateMonitoringPolicySchema>;

export const SignalSourceTypeEnum = z.enum([
  'manual_input',
  'file_replay',
  'webhook',
  'local_fixture',
  'external_provider'
]);
export type SignalSourceType = z.infer<typeof SignalSourceTypeEnum>;

export const SignalContentTypeEnum = z.enum([
  'profile',
  'post',
  'video',
  'audio',
  'image',
  'advertisement',
  'domain',
  'account'
]);
export type SignalContentType = z.infer<typeof SignalContentTypeEnum>;

export const SignalProcessingStatusEnum = z.enum([
  'pending',
  'processed',
  'correlated',
  'reviewed',
  'failed',
  'quarantined'
]);
export type SignalProcessingStatus = z.infer<typeof SignalProcessingStatusEnum>;

export interface MonitoringSignal {
  id: string;
  organization_id: string;
  subject_id: string;
  policy_id?: string | null;
  adapter_name: string;
  source_type: SignalSourceType;
  observed_url: string;
  normalized_url: string;
  platform: string;
  observed_at: string;
  content_type: SignalContentType;
  content_hash: string;
  metadata_hash: string;
  provenance: Record<string, any>;
  idempotency_key: string;
  processing_status: SignalProcessingStatus;
  raw_payload?: string | null;
  created_at: string;
  updated_at: string;
}

export const CreateSignalSchema = z.object({
  subject_id: z.string(),
  policy_id: z.string().optional(),
  adapter_name: z.string().min(2),
  source_type: SignalSourceTypeEnum,
  observed_url: z.string().min(5),
  platform: z.string().optional().default('other'),
  observed_at: z.string().datetime().optional(),
  content_type: SignalContentTypeEnum.optional().default('profile'),
  raw_payload: z.record(z.any()).optional(),
  provenance: z.record(z.any()).optional().default({})
});
export type CreateSignalInput = z.input<typeof CreateSignalSchema>;

export const BatchIngestSignalsSchema = z.object({
  signals: z.array(CreateSignalSchema).min(1).max(100)
});
export type BatchIngestSignalsInput = z.infer<typeof BatchIngestSignalsSchema>;

export interface CandidateCorrelation {
  id: string;
  signal_id: string;
  subject_id: string;
  matched_rules: string[];
  confidence_category: 'low' | 'medium' | 'high' | 'critical';
  confidence_score: number;
  risk_factors: string[];
  false_positive_indicators: string[];
  recommended_action: 'queue_for_review' | 'auto_link_candidate' | 'quarantine_low_confidence' | 'dismiss_false_positive';
  human_review_mandatory: number;
  correlated_at: string;
}

export interface RiskScoreFactorBreakdown {
  identity_match_score: number;
  domain_similarity_score: number;
  content_impersonation_score: number;
  brand_asset_abuse_score: number;
  prior_violation_multiplier: number;
  parody_fair_use_discount: number;
  final_score: number;
}

export const MANDATORY_SCORING_DISCLAIMER =
  'This is a prioritization signal for human review, not a legal or factual determination.';

export interface CandidateRiskScore {
  id: string;
  signal_id: string;
  score: number;
  score_version: string;
  factors: RiskScoreFactorBreakdown;
  threshold_applied: number;
  disclaimer: string;
  ruleset_identifier: string;
  calculated_at: string;
}

export const CandidateReviewStatusEnum = z.enum([
  'pending',
  'in_review',
  'confirmed',
  'dismissed',
  'quarantined'
]);
export type CandidateReviewStatus = z.infer<typeof CandidateReviewStatusEnum>;

export const AnalystDecisionEnum = z.enum([
  'confirm_candidate',
  'dismiss_benign',
  'dismiss_parody',
  'dismiss_authorized',
  'dismiss_unrelated',
  'quarantine_insufficient_evidence'
]);
export type AnalystDecision = z.infer<typeof AnalystDecisionEnum>;

export const FalsePositiveCategoryEnum = z.enum([
  'satire_parody',
  'authorized_affiliate',
  'unrelated_same_name',
  'commentary_criticism',
  'news_reporting',
  'fan_account'
]);
export type FalsePositiveCategory = z.infer<typeof FalsePositiveCategoryEnum>;

export interface CandidateReview {
  id: string;
  signal_id: string;
  organization_id: string;
  status: CandidateReviewStatus;
  priority: Priority;
  analyst_decision?: AnalystDecision | null;
  decision_reason?: string | null;
  false_positive_category?: FalsePositiveCategory | null;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
  case_id?: string | null;
  created_at: string;
  updated_at: string;
}

export const ReviewCandidateSchema = z.object({
  decision: AnalystDecisionEnum,
  decision_reason: z.string().min(5).max(1000),
  false_positive_category: FalsePositiveCategoryEnum.optional(),
  priority: PriorityEnum.optional(),
  link_to_existing_case_id: z.string().optional(),
  create_new_case: z.boolean().optional().default(false),
  case_title: z.string().optional(),
  case_category: IncidentCategoryEnum.optional()
});
export type ReviewCandidateInput = z.input<typeof ReviewCandidateSchema>;

export const SignalCaseLinkTypeEnum = z.enum([
  'evidence',
  'prior_art',
  'repeat_infringement',
  'alternate_profile'
]);
export type SignalCaseLinkType = z.infer<typeof SignalCaseLinkTypeEnum>;

export interface SignalCaseLink {
  id: string;
  signal_id: string;
  case_id: string;
  link_type: SignalCaseLinkType;
  linked_by_user_id: string;
  linked_at: string;
}

export const LinkSignalToCaseSchema = z.object({
  signal_id: z.string(),
  case_id: z.string(),
  link_type: SignalCaseLinkTypeEnum.default('evidence')
});
export type LinkSignalToCaseInput = z.infer<typeof LinkSignalToCaseSchema>;

export interface MonitoringAdapterMetadata {
  id: string;
  name: string;
  adapter_type: 'manual' | 'file_replay' | 'webhook' | 'local_fixture';
  description: string;
  config_schema: Record<string, any>;
  status: 'active' | 'disabled';
  is_safe_read_only: number;
  created_at: string;
}

// ============================================================================
// PHASE 7: DETECTION QUALITY EVALUATION, FALSE-POSITIVE REDUCTION,
// RED-TEAM TESTING & SAFE INTELLIGENCE ENRICHMENT
// ============================================================================

export const GroundTruthLabelEnum = z.enum([
  'confirmed_candidate',
  'benign_authorized',
  'false_positive',
  'uncertain',
  'insufficient_information',
  'out_of_scope'
]);
export type GroundTruthLabelType = z.infer<typeof GroundTruthLabelEnum>;

export const EvaluationScenarioCategoryEnum = z.enum([
  'exact_handle_impersonation',
  'near_match_handle',
  'same_name_unrelated_account',
  'authorized_affiliate',
  'fan_page',
  'parody',
  'satire',
  'criticism',
  'news_reporting',
  'look_alike_domain',
  'fake_doctor_endorsement',
  'fake_founder_discount',
  'synthetic_media_metadata_candidate',
  'mirror_url',
  'modified_reupload',
  'tracking_parameter_variant',
  'unicode_lookalike',
  'multilingual_content',
  'benign_official_account',
  'adversarially_crafted_misleading_signal'
]);
export type EvaluationScenarioCategory = z.infer<typeof EvaluationScenarioCategoryEnum>;

export const ScoreBandEnum = z.enum([
  'informational',
  'low',
  'medium',
  'high',
  'urgent'
]);
export type ScoreBand = z.infer<typeof ScoreBandEnum>;

export interface ScoreBandDefinition {
  band: ScoreBand;
  minScore: number;
  maxScore: number;
  operationalExplanation: string;
}

export const SCORE_BAND_DEFINITIONS: Record<ScoreBand, ScoreBandDefinition> = {
  informational: {
    band: 'informational',
    minScore: 0,
    maxScore: 19,
    operationalExplanation: 'Benign context, authorized domain match, or background signal; no priority action required.'
  },
  low: {
    band: 'low',
    minScore: 20,
    maxScore: 39,
    operationalExplanation: 'Minor lexical resemblance; low probability of consumer deception. Standard queued review.'
  },
  medium: {
    band: 'medium',
    minScore: 40,
    maxScore: 69,
    operationalExplanation: 'Notable similarity or potential affiliation overlap; prioritized operator review queue.'
  },
  high: {
    band: 'high',
    minScore: 70,
    maxScore: 84,
    operationalExplanation: 'Significant brand or likeness mimicry with scam patterns; urgent operator triage.'
  },
  urgent: {
    band: 'urgent',
    minScore: 85,
    maxScore: 100,
    operationalExplanation: 'Critical impersonation or high-confidence deceptive fraud pattern; highest priority triage.'
  }
};

export const RulesetStatusEnum = z.enum([
  'draft',
  'proposed',
  'approved',
  'active',
  'retired',
  'rolled_back'
]);
export type RulesetStatus = z.infer<typeof RulesetStatusEnum>;

export const SuppressionRuleTypeEnum = z.enum([
  'verified_official',
  'authorized_partner',
  'fan_page',
  'parody_satire',
  'criticism_commentary',
  'news_reporting',
  'unrelated_same_name',
  'previously_dismissed_pattern',
  'known_benign_domain'
]);
export type SuppressionRuleType = z.infer<typeof SuppressionRuleTypeEnum>;

export const DifficultyLevelEnum = z.enum([
  'easy',
  'medium',
  'hard',
  'adversarial'
]);
export type DifficultyLevel = z.infer<typeof DifficultyLevelEnum>;

export interface EvaluationDataset {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  target_subject_types: string[];
  scenario_categories: EvaluationScenarioCategory[];
  difficulty_distribution: Record<string, number>;
  total_fixtures: number;
  is_golden: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export const CreateEvaluationDatasetSchema = z.object({
  name: z.string().min(3).max(150),
  version: z.string().min(1).max(50),
  description: z.string().optional(),
  target_subject_types: z.array(z.string()).default([]),
  scenario_categories: z.array(EvaluationScenarioCategoryEnum).default([]),
  is_golden: z.boolean().default(false)
});
export type CreateEvaluationDatasetInput = z.input<typeof CreateEvaluationDatasetSchema>;

export interface SyntheticSubjectPayload {
  canonical_name: string;
  subject_type: string;
  official_domains: string[];
  official_social_urls: string[];
  aliases?: string[];
  handles?: string[];
}

export interface EvaluationFixture {
  id: string;
  dataset_id: string;
  scenario_category: EvaluationScenarioCategory;
  synthetic_subject: SyntheticSubjectPayload;
  synthetic_platform: string;
  normalized_url: string;
  observed_url: string;
  signal_metadata: Record<string, any>;
  expected_correlation_outcome: 'match' | 'no_match' | 'ambiguous';
  expected_risk_band: ScoreBand;
  expected_false_positive_label?: string | null;
  expected_human_review_requirement: number;
  difficulty_level: DifficultyLevel;
  language_or_script: string;
  dataset_version: string;
  provenance: Record<string, any>;
  reviewer_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export const CreateEvaluationFixtureSchema = z.object({
  dataset_id: z.string(),
  scenario_category: EvaluationScenarioCategoryEnum,
  synthetic_subject: z.object({
    canonical_name: z.string().min(2),
    subject_type: z.string(),
    official_domains: z.array(z.string()).default([]),
    official_social_urls: z.array(z.string()).default([]),
    aliases: z.array(z.string()).optional(),
    handles: z.array(z.string()).optional()
  }),
  synthetic_platform: z.string(),
  observed_url: z.string(),
  signal_metadata: z.record(z.any()).default({}),
  expected_correlation_outcome: z.enum(['match', 'no_match', 'ambiguous']),
  expected_risk_band: ScoreBandEnum,
  expected_false_positive_label: z.string().optional().nullable(),
  expected_human_review_requirement: z.number().default(1),
  difficulty_level: DifficultyLevelEnum.default('medium'),
  language_or_script: z.string().default('en'),
  provenance: z.record(z.any()).default({}),
  reviewer_notes: z.string().optional().nullable()
});
export type CreateEvaluationFixtureInput = z.input<typeof CreateEvaluationFixtureSchema>;

export interface GroundTruthLabel {
  id: string;
  fixture_id: string;
  reviewer_user_id: string;
  reviewer_email: string;
  label: GroundTruthLabelType;
  rationale: string;
  confidence: number;
  label_version: number;
  is_adjudicated: number;
  created_at: string;
}

export const SubmitGroundTruthLabelSchema = z.object({
  label: GroundTruthLabelEnum,
  rationale: z.string().min(5).max(2000),
  confidence: z.number().min(0.1).max(1.0).default(1.0)
});
export type SubmitGroundTruthLabelInput = z.infer<typeof SubmitGroundTruthLabelSchema>;

export interface FixtureAdjudication {
  id: string;
  fixture_id: string;
  adjudicator_user_id: string;
  adjudicator_email: string;
  resolved_label: GroundTruthLabelType;
  rationale: string;
  conflicting_label_ids: string[];
  statutory_notes?: string | null;
  adjudicated_at: string;
}

export const SubmitAdjudicationSchema = z.object({
  resolved_label: GroundTruthLabelEnum,
  rationale: z.string().min(10).max(3000),
  statutory_notes: z.string().optional()
});
export type SubmitAdjudicationInput = z.infer<typeof SubmitAdjudicationSchema>;

export interface RulesetWeights {
  exact_handle_weight: number;
  name_alias_weight: number;
  domain_similarity_weight: number;
  scam_keywords_weight: number;
  brand_asset_weight: number;
  prior_violation_multiplier: number;
  parody_discount_multiplier: number;
}

export interface RulesetThresholds {
  alert_threshold: number;
  auto_link_threshold: number;
  human_review_threshold: number;
}

export interface RulesetVersion {
  id: string;
  version_tag: string;
  name: string;
  description?: string | null;
  factor_weights: RulesetWeights;
  threshold_presets: RulesetThresholds;
  band_cutoffs: Record<string, number>;
  status: RulesetStatus;
  checksum: string;
  created_by_user_id: string;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const CreateRulesetVersionSchema = z.object({
  version_tag: z.string().min(3).max(50),
  name: z.string().min(3).max(100),
  description: z.string().optional(),
  factor_weights: z.object({
    exact_handle_weight: z.number().min(0).max(100),
    name_alias_weight: z.number().min(0).max(100),
    domain_similarity_weight: z.number().min(0).max(100),
    scam_keywords_weight: z.number().min(0).max(100),
    brand_asset_weight: z.number().min(0).max(100),
    prior_violation_multiplier: z.number().min(1.0).max(2.0),
    parody_discount_multiplier: z.number().min(0.0).max(1.0)
  }),
  threshold_presets: z.object({
    alert_threshold: z.number().min(0.1).max(1.0),
    auto_link_threshold: z.number().min(0.1).max(1.0),
    human_review_threshold: z.number().min(0.0).max(1.0)
  }),
  band_cutoffs: z.record(z.number()).default({
    informational_max: 19,
    low_max: 39,
    medium_max: 69,
    high_max: 84,
    urgent_max: 100
  })
});
export type CreateRulesetVersionInput = z.infer<typeof CreateRulesetVersionSchema>;

export interface EvaluationRun {
  id: string;
  organization_id: string;
  dataset_id: string;
  ruleset_id: string;
  run_type: 'offline_validation' | 'what_if_simulation' | 'regression_check';
  total_evaluated: number;
  executed_by_user_id: string;
  execution_duration_ms: number;
  status: 'running' | 'completed' | 'failed';
  notes?: string | null;
  created_at: string;
}

export interface EvaluationRunMetric {
  id: string;
  run_id: string;
  slice_dimension: 'global' | 'platform' | 'subject_type' | 'scenario_category' | 'score_band' | 'language';
  slice_value: string;
  total_signals: number;
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  false_positive_rate: number;
  false_negative_rate: number;
  precision_at_top_k: number;
  queue_yield: number;
  brier_calibration_score: number;
  avg_review_time_ms: number;
  duplicate_suppression_rate: number;
  normalization_success_rate: number;
  adapter_rejection_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  cost_per_signal_inr: number;
  confirmed_case_conversion_rate: number;
  created_at: string;
}

export interface SuppressionRule {
  id: string;
  organization_id: string;
  name: string;
  rule_type: SuppressionRuleType;
  pattern: string;
  pattern_type: 'exact_url' | 'domain_glob' | 'handle' | 'keyword';
  owner_user_id: string;
  justification: string;
  is_active: number;
  override_count: number;
  evaluation_tested: number;
  ruleset_version: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export const CreateSuppressionRuleSchema = z.object({
  name: z.string().min(3).max(120),
  rule_type: SuppressionRuleTypeEnum,
  pattern: z.string().min(1).max(500),
  pattern_type: z.enum(['exact_url', 'domain_glob', 'handle', 'keyword']),
  justification: z.string().min(5).max(1000),
  expires_in_days: z.number().min(1).max(365).default(30),
  ruleset_version: z.string().default('v1.0')
});
export type CreateSuppressionRuleInput = z.infer<typeof CreateSuppressionRuleSchema>;

export interface ReviewerEvaluation {
  id: string;
  organization_id: string;
  reviewer_user_id: string;
  total_reviews: number;
  confirmed_count: number;
  dismissed_count: number;
  quarantined_count: number;
  disagreement_count: number;
  override_count: number;
  avg_duration_seconds: number;
  sampled_for_second_review: number;
  coaching_notes?: string | null;
  recorded_at: string;
}

export interface RedTeamTestRun {
  id: string;
  test_vector_category: string;
  vector_name: string;
  input_payload: string;
  expected_defense_behavior: string;
  actual_behavior: string;
  defended_successfully: number;
  vulnerability_severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  remediation_notes?: string | null;
  executed_at: string;
}

export interface ProviderAnalysis {
  provider_id: string;
  provider_version: string;
  analysis_summary: string;
  feature_breakdown: Record<string, any>;
  confidence_bounds: { lower: number; upper: number };
  statutory_disclaimer: string;
  analyzed_at: string;
}

export interface IntelligenceProvider {
  readonly providerId: string;
  readonly version: string;
  analyze(signal: MonitoringSignal): Promise<ProviderAnalysis>;
}

// ============================================================================
// PHASE 8: CONTROLLED READ-ONLY INTEGRATIONS
// ============================================================================

export const ProviderTypeEnum = z.enum(['youtube']);
export type ProviderType = z.infer<typeof ProviderTypeEnum>;

export const ProviderConnectionStatusEnum = z.enum([
  'pending_auth',
  'connected',
  'degraded',
  'disconnected',
  'revoked',
  'error'
]);
export type ProviderConnectionStatus = z.infer<typeof ProviderConnectionStatusEnum>;

export const CircuitStateEnum = z.enum(['closed', 'open', 'half_open']);
export type CircuitState = z.infer<typeof CircuitStateEnum>;

export interface ProviderConnection {
  id: string;
  organization_id: string;
  provider_type: ProviderType;
  status: ProviderConnectionStatus;
  account_id?: string | null;
  account_name?: string | null;
  account_email?: string | null;
  scopes: string[];
  token_expires_at?: string | null;
  last_token_refresh_at?: string | null;
  last_successful_sync_at?: string | null;
  last_error?: string | null;
  error_count: number;
  is_canary: number;
  is_paused: number;
  metadata: Record<string, any>;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderConnectionWithSecrets extends ProviderConnection {
  encrypted_access_token?: string | null;
  encrypted_refresh_token?: string | null;
}

export interface ProviderSubjectLink {
  id: string;
  connection_id: string;
  subject_id: string;
  created_at: string;
}

export interface ProviderCursor {
  id: string;
  connection_id: string;
  feed_type: 'channel_uploads' | 'search_candidates';
  last_cursor?: string | null;
  last_synced_at: string;
  item_count: number;
  updated_at: string;
}

export interface ProviderCircuitState {
  connection_id: string;
  circuit_state: CircuitState;
  failure_count: number;
  consecutive_successes: number;
  last_failure_at?: string | null;
  last_failure_reason?: string | null;
  opened_at?: string | null;
  cooldown_until?: string | null;
  total_requests: number;
  total_failures: number;
  total_retries: number;
  updated_at: string;
}

export interface ProviderWebhookSubscription {
  id: string;
  connection_id: string;
  topic_url: string;
  hub_url: string;
  secret_hash: string;
  status: 'pending' | 'active' | 'expired' | 'failed';
  lease_seconds: number;
  expires_at?: string | null;
  last_event_at?: string | null;
  event_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderSignal {
  provider_type: ProviderType;
  provider_item_id: string;
  external_url: string;
  title: string;
  description: string;
  published_at: string;
  channel_id: string;
  channel_title: string;
  content_type: SignalContentType;
  raw_metadata: Record<string, any>;
}

export interface ProviderHealth {
  connection_id: string;
  status: 'healthy' | 'degraded' | 'circuit_open' | 'disconnected';
  circuit_state: CircuitState;
  request_count: number;
  failure_count: number;
  retry_count: number;
  rate_limit_remaining?: number;
  last_successful_poll?: string | null;
  last_failure?: string | null;
  last_failure_reason?: string | null;
}

export const InitiateOAuthSchema = z.object({
  provider_type: ProviderTypeEnum.default('youtube'),
  subject_id: z.string().optional(),
  redirect_uri: z.string().url().optional()
});
export type InitiateOAuthInput = z.infer<typeof InitiateOAuthSchema>;

export const CompleteOAuthSchema = z.object({
  provider_type: ProviderTypeEnum.default('youtube'),
  state: z.string().min(10),
  code: z.string().min(1),
  redirect_uri: z.string().url().optional()
});
export type CompleteOAuthInput = z.infer<typeof CompleteOAuthSchema>;

export const UpdateConnectionSettingsSchema = z.object({
  is_paused: z.number().int().min(0).max(1).optional(),
  is_canary: z.number().int().min(0).max(1).optional(),
  subject_ids: z.array(z.string()).optional()
});
export type UpdateConnectionSettingsInput = z.infer<typeof UpdateConnectionSettingsSchema>;



