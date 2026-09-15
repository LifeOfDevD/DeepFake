-- ============================================================================
-- DIGITAL IMPERSONATION RESPONSE DESK - PHASE 4 MIGRATION
-- Migration 0005: Platform Grievance Operations, Submissions, Escalations,
-- Statutory-Source Discipline & Re-upload Monitoring
-- ============================================================================

-- 1. Platform Registry Table
CREATE TABLE IF NOT EXISTS platform_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  country_or_jurisdiction TEXT NOT NULL DEFAULT 'Global',
  supported_complaint_categories TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  impersonation_policy_url TEXT,
  privacy_or_ncii_policy_url TEXT,
  copyright_trademark_policy_url TEXT,
  grievance_contact_route TEXT NOT NULL,
  required_fields TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  accepted_evidence_types TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  max_attachment_size_mb INTEGER NOT NULL DEFAULT 25,
  supported_languages TEXT NOT NULL DEFAULT '["en", "hi"]', -- JSON array of strings
  expected_acknowledgement_window_hours INTEGER NOT NULL DEFAULT 24,
  expected_response_window_hours INTEGER NOT NULL DEFAULT 72,
  escalation_route TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  verification_source TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Platform Policy Versions Table
CREATE TABLE IF NOT EXISTS platform_policy_versions (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platform_registry(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  policy_type TEXT NOT NULL, -- 'impersonation', 'ncii_privacy', 'terms_of_service', 'intermediary_rules'
  policy_url TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  summary_of_terms TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Platform Playbooks Table
CREATE TABLE IF NOT EXISTS platform_playbooks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  incident_category TEXT NOT NULL,
  applicable_platforms TEXT NOT NULL DEFAULT '["all"]', -- JSON array of platform slugs or 'all'
  required_intake_fields TEXT NOT NULL DEFAULT '[]', -- JSON array of field names
  required_evidence_types TEXT NOT NULL DEFAULT '[]', -- JSON array of evidence types
  recommended_factual_language TEXT NOT NULL,
  prohibited_unsupported_assertions TEXT NOT NULL DEFAULT '[]', -- JSON array of warnings
  declaration_requirements TEXT NOT NULL DEFAULT '[]', -- JSON array of declaration clauses
  requires_legal_review INTEGER NOT NULL DEFAULT 0,
  escalation_rules TEXT NOT NULL DEFAULT '[]', -- JSON array
  expected_response_clock_type TEXT NOT NULL DEFAULT 'it_rules_2021_72h_standard',
  expected_response_window_hours INTEGER NOT NULL DEFAULT 72,
  packet_template_markdown TEXT NOT NULL,
  human_approval_requirements TEXT NOT NULL DEFAULT '["evidence_sufficiency", "platform_route_selection"]', -- JSON array
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Submissions Table (11-Stage Workflow)
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  platform_id TEXT NOT NULL REFERENCES platform_registry(id) ON DELETE RESTRICT,
  playbook_id TEXT NOT NULL REFERENCES platform_playbooks(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- States: draft, needs_information, ready_for_review, approved_for_simulation,
  -- simulated_submitted, acknowledged, response_received, action_taken, rejected,
  -- escalation_required, closed
  packet_version INTEGER NOT NULL DEFAULT 1,
  packet_hash TEXT NOT NULL,
  packet_payload_json TEXT NOT NULL,
  packet_markdown TEXT NOT NULL,
  simulated_reference_id TEXT,
  simulated_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Submission Transitions Audit Ledger
CREATE TABLE IF NOT EXISTS submission_transitions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  packet_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Submission Approvals (Faceted Approvals Bound to Packet Hash)
CREATE TABLE IF NOT EXISTS submission_approvals (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  approval_facet TEXT NOT NULL, -- 'legal_sufficiency', 'evidence_sufficiency', 'platform_route_selection', 'simulated_submission'
  packet_hash TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  decided_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_role TEXT NOT NULL,
  decision TEXT NOT NULL, -- 'approved', 'rejected'
  decision_reason TEXT NOT NULL,
  is_superseded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 7. Submission Responses Table (Manual Ingestion)
CREATE TABLE IF NOT EXISTS submission_responses (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  platform_id TEXT NOT NULL REFERENCES platform_registry(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  acknowledgement_received_at TEXT,
  response_received_at TEXT,
  platform_reference_number TEXT,
  response_category TEXT NOT NULL,
  -- 'takedown_completed', 'content_not_found', 'insufficient_evidence', 'not_violating_policy',
  -- 'counter_notice_received', 'appeal_suggested', 'escalated_internally', 'acknowledged_pending_review'
  requested_additional_information TEXT,
  takedown_result TEXT NOT NULL DEFAULT 'pending',
  -- 'pending', 'removed', 'geoblocked_india_only', 'demoted_or_labeled', 'no_action', 'account_suspended'
  rejection_reason TEXT,
  escalation_required INTEGER NOT NULL DEFAULT 0,
  operator_notes TEXT,
  attached_evidence_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of evidence IDs
  recorded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 8. Case Escalations Table
CREATE TABLE IF NOT EXISTS case_escalations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  submission_id TEXT REFERENCES submissions(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  trigger_type TEXT NOT NULL,
  -- 'no_acknowledgement', 'no_response', 'platform_rejection', 'repeated_reupload',
  -- 'incorrect_complaint_route', 'missing_evidence', 'suspected_legal_risk',
  -- 'court_or_government_order_required', 'human_review_required'
  severity TEXT NOT NULL DEFAULT 'p2', -- 'p1', 'p2', 'p3'
  assigned_owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  due_at TEXT,
  recommended_next_action TEXT NOT NULL,
  -- 'gac_appeal_rule_3a', 'cybercrime_ncrp_filing', 'commercial_court_injunction',
  -- 'nodal_officer_escalation', 'gather_additional_evidence', 'switch_complaint_route'
  supporting_evidence_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
  resolution_status TEXT NOT NULL DEFAULT 'open', -- 'open', 'investigating', 'action_recommended', 'resolved', 'dismissed'
  resolution_notes TEXT,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 9. Related Content / Re-Upload Observations Table (Metadata-Only)
CREATE TABLE IF NOT EXISTS related_content_observations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  observed_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  platform_id TEXT REFERENCES platform_registry(id) ON DELETE RESTRICT,
  target_entity TEXT NOT NULL,
  content_hash TEXT,
  relationship TEXT NOT NULL,
  -- 'same_content', 'modified_reupload', 'mirror', 'related_account', 'successor_url', 'suspected_duplicate'
  similarity_score REAL NOT NULL DEFAULT 1.0,
  operator_notes TEXT,
  status TEXT NOT NULL DEFAULT 'suspected', -- 'suspected', 'confirmed', 'dismissed'
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 10. Alter statutory_clocks with Statutory-Source Discipline Columns
-- SQLite ALTER TABLE ADD COLUMN succeeds only once per column
-- Using conditional alter helper via script or individual statements
ALTER TABLE statutory_clocks ADD COLUMN operational_rule TEXT DEFAULT 'IT_RULES_2021_RULE_3_2_B';
ALTER TABLE statutory_clocks ADD COLUMN jurisdiction TEXT DEFAULT 'IN-National';
ALTER TABLE statutory_clocks ADD COLUMN source_citation TEXT DEFAULT 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021';
ALTER TABLE statutory_clocks ADD COLUMN source_url_or_identifier TEXT DEFAULT 'https://www.meity.gov.in/writereaddata/files/Intermediary_Guidelines_and_Digital_Media_Ethics_Code_Rules-2021.pdf';
ALTER TABLE statutory_clocks ADD COLUMN effective_date TEXT DEFAULT '2021-02-25';
ALTER TABLE statutory_clocks ADD COLUMN last_verified_date TEXT DEFAULT '2026-09-01';
ALTER TABLE statutory_clocks ADD COLUMN deadline_type TEXT DEFAULT 'legally_mandatory';

-- 11. Performance and Tenant Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_platform_registry_slug ON platform_registry(slug);
CREATE INDEX IF NOT EXISTS idx_platform_playbooks_category ON platform_playbooks(incident_category);
CREATE INDEX IF NOT EXISTS idx_submissions_case_org ON submissions(case_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_sub_trans_submission ON submission_transitions(submission_id);
CREATE INDEX IF NOT EXISTS idx_sub_approvals_submission_hash ON submission_approvals(submission_id, packet_hash);
CREATE INDEX IF NOT EXISTS idx_sub_responses_sub ON submission_responses(submission_id);
CREATE INDEX IF NOT EXISTS idx_escalations_case_org ON case_escalations(case_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON case_escalations(resolution_status);
CREATE INDEX IF NOT EXISTS idx_related_content_norm_url ON related_content_observations(organization_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_related_content_case ON related_content_observations(case_id);

-- 12. Seed Platform Registry with Initial Key Platforms
INSERT OR IGNORE INTO platform_registry (
  id, name, slug, domain, country_or_jurisdiction,
  supported_complaint_categories, impersonation_policy_url, privacy_or_ncii_policy_url, copyright_trademark_policy_url,
  grievance_contact_route, required_fields, accepted_evidence_types, max_attachment_size_mb, supported_languages,
  expected_acknowledgement_window_hours, expected_response_window_hours, escalation_route, last_verified_at, verification_source
) VALUES
(
  'plt_instagram', 'Instagram', 'instagram', 'instagram.com', 'IN-Intermediary',
  '["fake_social_profile", "synthetic_media_endorsement", "ncii_or_intimate_image", "copyright_trademark_misuse"]',
  'https://help.instagram.example/impersonation', 'https://help.instagram.example/privacy', 'https://help.instagram.example/ip',
  'grievance-officer-india@meta.example', '["contested_url", "target_entity", "reporter_id_proof", "declaration"]',
  '["image", "pdf", "video", "screenshot"]', 25, '["en", "hi"]',
  24, 72, 'Grievance Appellate Committee (GAC) under IT Rules 2021 Rule 3A', '2026-09-01T00:00:00Z', 'Statutory Nodal Filing'
),
(
  'plt_meta', 'Meta (Facebook)', 'meta', 'facebook.com', 'IN-Intermediary',
  '["fake_social_profile", "brand_impersonation", "synthetic_media_endorsement", "ncii_or_intimate_image", "defamation_legal_escalation"]',
  'https://facebook.example/help/impersonation', 'https://facebook.example/help/privacy', 'https://facebook.example/help/ip',
  'grievance-officer-india@meta.example', '["contested_url", "target_entity", "corporate_authorization", "declaration"]',
  '["image", "pdf", "video", "screenshot"]', 50, '["en", "hi"]',
  24, 72, 'Grievance Appellate Committee (GAC) under IT Rules 2021 Rule 3A', '2026-09-01T00:00:00Z', 'Statutory Nodal Filing'
),
(
  'plt_youtube', 'YouTube', 'youtube', 'youtube.com', 'IN-Intermediary',
  '["synthetic_media_endorsement", "brand_impersonation", "copyright_trademark_misuse", "defamation_legal_escalation"]',
  'https://support.google.example/youtube/answer/impersonation', 'https://support.google.example/youtube/answer/privacy', 'https://support.google.example/youtube/answer/copyright',
  'support-in@google.example', '["contested_url", "target_entity", "timestamp_markers", "declaration"]',
  '["video", "screenshot", "pdf"]', 100, '["en", "hi"]',
  24, 72, 'Grievance Appellate Committee (GAC) under IT Rules 2021 Rule 3A', '2026-09-01T00:00:00Z', 'Statutory Nodal Filing'
),
(
  'plt_x', 'X (formerly Twitter)', 'x', 'x.com', 'IN-Intermediary',
  '["fake_social_profile", "synthetic_media_endorsement", "defamation_legal_escalation"]',
  'https://help.x.example/impersonation', 'https://help.x.example/privacy', 'https://help.x.example/copyright',
  'grievance-officer-in@x.example', '["contested_url", "target_entity", "handle", "declaration"]',
  '["screenshot", "pdf", "image"]', 25, '["en", "hi"]',
  24, 72, 'Grievance Appellate Committee (GAC) under IT Rules 2021 Rule 3A', '2026-09-01T00:00:00Z', 'Statutory Nodal Filing'
),
(
  'plt_telegram', 'Telegram', 'telegram', 'telegram.org', 'Global-Messaging',
  '["fake_support_account", "brand_impersonation", "ncii_or_intimate_image"]',
  'https://telegram.example/faq/impersonation', 'https://telegram.example/privacy', 'https://telegram.example/dmca',
  'abuse@telegram.example', '["contested_url", "channel_id", "target_entity", "declaration"]',
  '["screenshot", "pdf", "image"]', 20, '["en"]',
  24, 72, 'National Cyber Crime Reporting Portal (NCRP) / CERT-In Escalation', '2026-09-01T00:00:00Z', 'Platform Public Registry'
),
(
  'plt_linkedin', 'LinkedIn', 'linkedin', 'linkedin.com', 'IN-Intermediary',
  '["fake_profile", "brand_or_founder_impersonation", "fake_endorsement"]',
  'https://linkedin.example/help/impersonation', 'https://linkedin.example/help/privacy', 'https://linkedin.example/help/copyright',
  'grievance-india@linkedin.example', '["contested_url", "target_entity", "profile_url", "declaration"]',
  '["screenshot", "pdf"]', 25, '["en", "hi"]',
  24, 72, 'Grievance Appellate Committee (GAC) under IT Rules 2021 Rule 3A', '2026-09-01T00:00:00Z', 'Statutory Nodal Filing'
),
(
  'plt_generic_web', 'Generic Web Host / Registrar', 'generic_web', 'internet', 'Global-Hosting',
  '["look_alike_domain", "defamation_or_legal_escalation", "brand_impersonation"]',
  'https://abuse.example/domain', 'https://abuse.example/privacy', 'https://abuse.example/trademark',
  'abuse@registrar.example', '["contested_url", "whois_records", "trademark_registration", "declaration"]',
  '["pdf", "screenshot"]', 50, '["en"]',
  48, 120, 'NIXI / IN Registry .INDRP dispute or Commercial Court Injunction', '2026-09-01T00:00:00Z', 'ICANN / NIXI Framework'
);

-- 13. Seed Platform Playbooks with 9 Standard Scenarios
INSERT OR IGNORE INTO platform_playbooks (
  id, slug, title, description, incident_category, applicable_platforms,
  required_intake_fields, required_evidence_types, recommended_factual_language,
  prohibited_unsupported_assertions, declaration_requirements, requires_legal_review,
  escalation_rules, expected_response_clock_type, expected_response_window_hours,
  packet_template_markdown, human_approval_requirements
) VALUES
(
  'pb_fake_profile', 'fake_profile', 'Fake Social Media Profile Takedown',
  'Removes fraudulent accounts mimicking an individual, doctor, or executive.',
  'fake_social_profile', '["all"]',
  '["contested_url", "target_entity", "impersonation_method"]', '["screenshot", "image"]',
  'The contested account utilizes the name, photograph, and professional likeness of the victim without authorization, leading followers to believe it is operated by the authentic individual.',
  '["Do not assert criminal guilt without registered FIR", "Do not claim financial fraud unless monetary transfer evidence is documented"]',
  '["Victim confirms they do not own or authorize the contested account", "Information provided is true under penalty of perjury"]',
  0, '["Escalate to Nodal Officer if not acknowledged within 24h", "Escalate to GAC if refused"]',
  'it_rules_2021_72h_standard', 72,
  '# Notice of Impersonation and Request for Account Removal\n\n**Platform:** {{platform}}\n**Target:** {{target_entity}}\n**Contested URL:** {{contested_url}}\n\nUnder Rule 3(1)(b) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, an intermediary must not host content that impersonates another person.',
  '["evidence_sufficiency", "platform_route_selection"]'
),
(
  'pb_brand_founder', 'brand_or_founder_impersonation', 'Brand or Founder Executive Impersonation',
  'Removes fraudulent accounts and domains imitating enterprise brands, logos, or founders.',
  'brand_impersonation', '["all"]',
  '["contested_url", "target_entity", "target_entity_type"]', '["screenshot", "pdf", "image"]',
  'The contested presence displays official corporate trademarks and claims to represent executive leadership, misleading clients and investors.',
  '["Do not allege money laundering without law enforcement certification"]',
  '["Declarant is an authorized corporate representative", "Trademarks are registered and active in India"]',
  1, '["Escalate to legal counsel if counter-notice received"]',
  'it_rules_2021_72h_standard', 72,
  '# Corporate Notice under IT Act 2000 & Trademarks Act 1999\n\n**Entity:** {{target_entity}}\n**URL:** {{contested_url}}\n\nPlease disable this unauthorized account immediately to prevent further commercial deception.',
  '["legal_sufficiency", "evidence_sufficiency", "platform_route_selection"]'
),
(
  'pb_fake_endorsement', 'fake_endorsement', 'Fake Endorsement & Commercial Misuse',
  'Removes unauthorized commercial endorsements featuring doctors, experts, or public figures.',
  'synthetic_media_endorsement', '["instagram", "meta", "youtube"]',
  '["contested_url", "target_entity", "harm_type"]', '["screenshot", "video", "pdf"]',
  'The contested promotion falsely portrays the target professional recommending products or investments without consent, violating Consumer Protection Act 2019 Guidelines on Misleading Ads.',
  '["Do not claim consumer injury without verified patient complaint"]',
  '["Professional has never prescribed or endorsed the promoted product"]',
  1, '["File complaint with ASCI and CCPA if ad campaign continues"]',
  'it_rules_2021_72h_standard', 72,
  '# Cease and Desist Notice — Deceptive Commercial Endorsement\n\n**Professional:** {{target_entity}}\n**Contested Ad/URL:** {{contested_url}}\n\nThis promotional material constitutes deceptive endorsement and must be removed under Rule 3(1)(b).',
  '["legal_sufficiency", "evidence_sufficiency", "platform_route_selection", "simulated_submission"]'
),
(
  'pb_synthetic_media', 'synthetic_media_impersonation', 'Synthetic Media / Deepfake Takedown',
  'Expedited grievance against AI-generated voice clones, face-swaps, or multimodal deepfakes.',
  'synthetic_media_endorsement', '["all"]',
  '["contested_url", "target_entity", "suspected_synthetic_media_type"]', '["video", "audio", "screenshot"]',
  'The published media contains algorithmically synthesized voice/likeness fabricated to simulate statements never uttered by the victim, violating Section 66D IT Act 2000.',
  '["Do not assert state-sponsored actor origin without forensic attribution report"]',
  '["Target entity confirms the audio/video is entirely fabricated"]',
  1, '["Notify Platform Grievance Officer and MeitY Deepfake Advisory cell"]',
  'it_rules_2021_72h_standard', 72,
  '# Formal Section 79 / IT Rules Notice: Synthetic Media Impersonation\n\n**Target:** {{target_entity}}\n**Synthetic Type:** {{suspected_synthetic_media_type}}\n**Contested URL:** {{contested_url}}\n\nNotice is hereby provided under IT Rules 2021.',
  '["legal_sufficiency", "evidence_sufficiency", "platform_route_selection", "simulated_submission"]'
),
(
  'pb_ncii_intimate', 'ncii_or_intimate_image', 'Expedited NCII / Intimate Likeness Abuse',
  'Emergency 24-hour removal under Rule 3(2)(b) for non-consensual sexual or intimate synthetic imagery.',
  'privacy_or_likeness_complaint', '["all"]',
  '["contested_url", "target_entity", "involves_intimate_imagery"]', '["screenshot"]',
  'The content depicts the victim in partial/full nudity or simulates an intimate sexual act without consent, invoking mandatory 24-hour statutory takedown under Rule 3(2)(b).',
  '["NEVER upload or preserve raw explicit media in unencrypted storage; preserve URL and non-explicit evidence"]',
  '["Victim certifies the depiction is non-consensual and requests immediate disablement"]',
  1, '["Trigger immediate 24h statutory clock; escalate to Cyber Crime helpline 1930 if ignored"]',
  'it_rules_2021_24h_intimate', 24,
  '# URGENT: Statutory Takedown Demand under IT Rules 2021 Rule 3(2)(b) (24-Hour Mandatory Window)\n\n**Recipient:** Grievance Officer, {{platform}}\n**Contested URL:** {{contested_url}}\n\nDemand for immediate disablement within 24 hours.',
  '["legal_sufficiency", "evidence_sufficiency", "platform_route_selection", "simulated_submission"]'
),
(
  'pb_copyright_tm', 'copyright_trademark_misuse', 'Copyright and Trademark Abuse',
  'Notices against intellectual property infringements and counterfeiting.',
  'copyright_trademark_misuse', '["all"]',
  '["contested_url", "target_entity"]', '["pdf", "image"]',
  'The contested material uses protected copyrighted creative assets and registered trademarks without license.',
  '["Do not assert criminal piracy without certified registration certificates"]',
  '["Declarant owns or is exclusive licensee of the copyrighted work/trademark"]',
  1, '["Issue DMCA / Section 79 Notice; prepare court injunction if non-responsive"]',
  'it_rules_2021_72h_standard', 72,
  '# Notice of Intellectual Property Infringement\n\n**Owner:** {{target_entity}}\n**Infringing URL:** {{contested_url}}\n\nRequesting immediate removal of unauthorized assets.',
  '["legal_sufficiency", "evidence_sufficiency"]'
),
(
  'pb_fake_support', 'fake_support_account', 'Fraudulent Customer Support Account',
  'Takedowns against fake customer support accounts soliciting sensitive credentials.',
  'fake_support_account', '["telegram", "x", "instagram", "meta"]',
  '["contested_url", "target_entity", "harm_type"]', '["screenshot"]',
  'The contested profile purports to be the official help desk and solicits OTPs, passwords, or banking details from consumers.',
  '["Do not accuse individuals of criminal conspiracy without transaction logs"]',
  '["Entity confirms no support is offered via the contested handle"]',
  0, '["Flag to Indian Cyber Crime Coordination Centre (I4C) if phishing is detected"]',
  'it_rules_2021_72h_standard', 72,
  '# Phishing & Impersonation Alert: Deceptive Support Handle\n\n**Organization:** {{target_entity}}\n**Handle/URL:** {{contested_url}}\n\nProfile is harvesting credentials fraudulently.',
  '["evidence_sufficiency", "platform_route_selection"]'
),
(
  'pb_lookalike_domain', 'look_alike_domain', 'Look-Alike Domain & Typosquatting',
  'Registrar and hosting takedowns for phishing domains imitating authentic brands.',
  'look_alike_domain', '["generic_web"]',
  '["contested_url", "target_entity"]', '["screenshot", "pdf"]',
  'The contested domain typosquats official brand name to deceive visitors into entering financial credentials.',
  '["Do not initiate domain transfer without trademark registration"]',
  '["Brand owner holds prior registered rights to the trademark"]',
  1, '["File INDRP with NIXI or UDRP with WIPO"]',
  'it_rules_2021_72h_standard', 72,
  '# Abuse Complaint to Registrar / Host — Typosquatting Domain\n\n**Target Brand:** {{target_entity}}\n**Contested Domain:** {{contested_url}}\n\nPlease suspend DNS resolution for malicious domain.',
  '["legal_sufficiency", "evidence_sufficiency"]'
),
(
  'pb_defamation', 'defamation_or_legal_escalation', 'Defamation & Legal Escalation',
  'Formal Section 79 legal notices for defamatory synthetic campaigns causing severe injury.',
  'defamation_legal_escalation', '["all"]',
  '["contested_url", "target_entity", "factual_basis"]', '["screenshot", "pdf", "video"]',
  'The publication makes unverified, false factual allegations against the target individual intending to harm reputation under Section 356 Bharatiya Nyaya Sanhita 2023.',
  '["Do not assert defamation on matters of honest public review or fair comment"]',
  '["Complainant affirms under oath that the published statements are false"]',
  1, '["Requires advocate sign-off; prepare pre-action legal notice"]',
  'it_rules_2021_72h_standard', 72,
  '# Formal Legal Notice under Section 79 IT Act & Section 356 BNS 2023\n\n**Complainant:** {{target_entity}}\n**URL:** {{contested_url}}\n\nDemand for immediate removal of defamatory publication.',
  '["legal_sufficiency", "evidence_sufficiency", "platform_route_selection", "simulated_submission"]'
);
