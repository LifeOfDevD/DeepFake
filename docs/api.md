# Digital Impersonation Response Desk — API Reference

## 1. Overview & Authentication Model

The Digital Impersonation Response Desk REST API provides case management, evidence locker operations, and forensic chain-of-custody tracking.

### 1.1 Authentication & Tenant Context

Requests are authenticated and scoped to an organization using HTTP headers:

| Header | Production | Development / Test | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | **Required** (`Bearer desk_tok_...`) | Supported | Cryptographically signed HMAC-SHA256 bearer session token. |
| `x-user-id` | **Strictly Disallowed** (Returns `401 HEADER_AUTH_DISALLOWED`) | Supported | Direct user ID override for local development and test automation. |
| `x-user-email` | **Strictly Disallowed** (Returns `401 HEADER_AUTH_DISALLOWED`) | Supported | Direct user email override for local development and test automation. |
| `x-organization-id` | **Required** | **Required** | Target tenant identifier. Cross-tenant access without membership is audited and restricted to `system_admin`. |

#### Session Token Format
```
desk_tok_<base64url(JSON_payload)>.<base64url(hmac_sha256_signature)>
```
Payload structure:
```json
{
  "userId": "usr_apex_mgr_02",
  "email": "priya.nair@apexhealth.example",
  "systemRole": "user",
  "iat": 1773316800,
  "exp": 1773403200
}
```

---

## 2. Case Management Endpoints

### `GET /api/cases`
List cases belonging to the active organization.
- **Roles**: All tenant roles.

### `POST /api/cases`
Create a new impersonation incident case.
- **Roles**: `org_owner`, `org_admin`, `case_manager`, `analyst`, `system_admin`.
- **Request Body**:
```json
{
  "title": "Unauthorized Deepfake Endorsement on Instagram",
  "category": "video_deepfake",
  "priority": "high",
  "target_entity": "Dr. Anand Verma",
  "contested_url": "https://instagram.example/reel/987654",
  "hosting_platform": "instagram",
  "reported_by_email": "dr.verma@apexhealth.example"
}
```

### `GET /api/cases/:id`
Fetch single case record by case ID.

### `PATCH /api/cases/:id/status`
Perform audited state transition on case status.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "status": "in_review",
  "reason": "Initial evidence verified by response team"
}
```

---

## 3. Evidence Locker & Custody Endpoints

### `POST /api/cases/:caseId/evidence`
Upload a binary artifact or register a source URL evidence record.

#### Option A: Binary Multipart Upload (`multipart/form-data`)
- **Fields**:
  - `file`: Raw binary attachment (streamed directly to disk; magic bytes verified; max size 50MB-500MB depending on type).
  - `safe_display_name` *(optional)*: Sanitized name for UI display.
  - `sensitivity` *(optional)*: `'normal' | 'sensitive' | 'restricted' | 'prohibited'`.
  - `captured_at` *(optional)*: ISO timestamp of artifact acquisition.

#### Option B: JSON Source URL Registration (`application/json`)
- **Body**:
```json
{
  "source_url": "https://suspicious-domain.example/ad/fake-clinic",
  "safe_display_name": "Deceptive Advertisement Landing Page",
  "operator_notes": "Impersonating CMO likeness and clinic trademark",
  "sensitivity": "normal"
}
```
*Note: Source URLs undergo strict SSRF pre-flight validation. Loopback, private IP ranges (RFC 1918), link-local, cloud metadata hostnames, and malformed encodings are blocked without DNS resolution.*

---

### `GET /api/cases/:caseId/evidence`
List all active (non-deleted) evidence items associated with a case.

### `GET /api/evidence/:evidenceId`
Retrieve metadata, cryptographic SHA-256 digest, and active legal retention holds for an evidence item.

---

### `GET /api/evidence/:evidenceId/download-token` (also `POST`)
Generate a signed, time-limited single-use download token.
- **Validity**: 300 seconds (5 minutes).
- **Roles**: Authorized tenant roles. Quarantined or prohibited items require `case_manager`, `legal_reviewer`, `org_owner`, or `system_admin`.
- **Response**:
```json
{
  "success": true,
  "data": {
    "token": "eyJldmlkZW5jZUlkIjoiZXZf...<sig>",
    "expires_in_seconds": 300,
    "download_url": "/api/evidence/ev_0123456789abcdef/download?token=eyJldmlk..."
  }
}
```

---

### `GET /api/evidence/:evidenceId/download`
Stream evidence binary file from storage.
- **Authentication**: Either standard session headers OR `?token=<download_token>` query parameter.
- **Response Headers**:
  - `Content-Type`: Sniffed MIME type (e.g. `image/png`, `video/mp4`).
  - `Content-Disposition`: `attachment; filename="<sanitized_name>"`
  - `ETag`: `"<sha256_hash>"`
  - `X-Content-Type-Options`: `nosniff`
- **Error Codes**:
  - `410 Gone`: Evidence has been securely purged / tombstoned.
  - `403 Forbidden`: Insufficient role permissions or expired download token.

---

### `POST /api/evidence/:evidenceId/mark-sensitive`
Change sensitivity classification (`normal`, `sensitive`, `restricted`, `prohibited`).
- Marking an item `prohibited` automatically transitions its state to `quarantined`.
- **Roles**: `case_manager`, `analyst`, `legal_reviewer`, `org_owner`. Read-only stakeholders are blocked.

---

### `POST /api/evidence/:evidenceId/legal-hold`
Place an immutable legal retention hold on an evidence item.
- Prevents deletion, purge, or automated retention sweeps until explicitly released.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "reason": "Section 79 Notice litigation requirement"
}
```

### `POST /api/evidence/:evidenceId/release-hold`
Release an existing legal retention hold.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "reason": "Litigation hold expired following compliance confirmation"
}
```

---

## 4. Two-Person Deletion Approval Workflow

Physical evidence destruction requires dual authorization to prevent unilateral destruction of legal evidence.

```mermaid
sequenceDiagram
  autonumber
  actor Requester as Operator A (Requester)
  actor Approver as Operator B (Approver)
  participant API as Response Desk API
  participant Store as Storage & Ledger

  Requester->>API: POST /evidence/:id/deletion-request { reason }
  API->>Store: State -> deletion_requested; record request
  Note over API,Store: Item locked; single-person delete blocked

  Approver->>API: POST /evidence/:id/approve-deletion { reason }
  Note over API: Verify Approver != Requester
  Note over API: Check legal_hold == 0
  API->>Store: Purge binary; overwrite tombstone; State -> deleted
  API-->>Approver: 200 OK (Purged & Tombstoned)
```

### `POST /api/evidence/:evidenceId/deletion-request`
Submit a formal request for evidence file deletion.
- Sets evidence status to `deletion_requested`.
- **Roles**: `case_manager`, `org_owner`, `analyst`, `system_admin`.
- **Request Body**:
```json
{
  "reason": "GDPR / DPDP erasure request from complainant"
}
```

### `POST /api/evidence/:evidenceId/approve-deletion`
Approve an existing deletion request and purge physical storage.
- **Constraint**: The approving user **cannot** be the user who requested deletion. Self-approval returns `403 EVIDENCE_ACCESS_DENIED`.
- **Legal Hold Check**: If `legal_hold = 1`, deletion is rejected with `409 LEGAL_HOLD_ACTIVE`.
- **Action**: Physical file is unlinked; metadata record is tombstoned with `deleted_at`, `deletion_reason`, and `status = 'deleted'`.
- **Roles**: `case_manager`, `org_owner`, `system_admin`.

### `POST /api/evidence/:evidenceId/reject-deletion`
Reject a pending deletion request and restore the evidence to active status (`available` or `quarantined`).
- **Roles**: `case_manager`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "reason": "Evidence required for ongoing regulatory investigation"
}
```

---

## 5. Chain-of-Custody & Retention Maintenance

### `GET /api/evidence/:evidenceId/custody`
Returns the append-only chain-of-custody audit log for an evidence item, including uploads, downloads, legal holds, sensitivity classifications, and deletion requests.
- **Roles**: All authorized tenant members.

### `POST /api/admin/retention/enforce`
Trigger an automated retention sweep across the organization's evidence inventory.
- Purges physical payloads for evidence items where `retention_until < NOW()` and `legal_hold = 0`.
- Records `retention.purged` audit events and marks records `retention_expired`.
- **Roles**: `case_manager`, `org_owner`, `system_admin`.

---

---

## 7. Phase 3 Incident Intake & Metadata

Cases support expanded statutory intake fields aligned with Indian cyber law and intermediary guidelines.

### `POST /api/cases` (Enhanced)
Accepts complete intake taxonomy:
```json
{
  "title": "Unauthorized Deepfake Endorsement on Instagram",
  "category": "video_deepfake",
  "priority": "high",
  "target_entity": "Dr. Anand Verma",
  "target_entity_type": "doctor_healthcare",
  "contested_url": "https://instagram.example/reel/987654",
  "hosting_platform": "instagram",
  "urgency": "critical",
  "synthetic_media_type": "video_face_swap",
  "impersonation_method": "likeness_theft",
  "harm_type": "medical_misinformation",
  "is_intimate_imagery": false,
  "defamation_factual_basis": "Promoting fake cancer cure using fabricated video clip of Dr. Verma",
  "court_order_available": false
}
```

---

## 8. Triage & Statutory Classification

### `GET /api/cases/:id/triage`
Fetch latest deterministic triage assessment record for the case.
- **Roles**: All tenant roles.
- **Response**:
```json
{
  "success": true,
  "data": {
    "triage": {
      "case_id": "cas_0123456789abcdef",
      "route": "rule_3_2_b_intimate_expedited",
      "severity": "critical",
      "statutory_basis": "IT Rules 2021 Rule 3(2)(b) (24h Expedited Removal); IT Act Sec 66E",
      "triggered_rules": "[\"RULE_3_2_B_EXPEDITED_INTIMATE\",\"IT_ACT_SEC_66E_PRIVACY\"]",
      "recommendations": "[\"Deploy 24-hour statutory clock\",\"Prioritize legal reviewer dispatch\"]",
      "performed_by": "system"
    }
  }
}
```

### `POST /api/cases/:id/triage/classify`
Trigger or re-evaluate deterministic triage classification against current case metadata.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

---

## 9. Statutory Clock Tracking (Asia/Kolkata IST)

### `GET /api/cases/:id/clocks`
Retrieve all active and completed statutory clocks for a case with IST timestamps and countdown hours.
- **Roles**: All tenant roles.
- **Response**:
```json
{
  "success": true,
  "data": {
    "clocks": [
      {
        "id": "clk_0123456789abcdef",
        "clock_type": "it_rules_2021_24h_intimate",
        "statutory_reference": "IT Rules 2021 Rule 3(2)(b)",
        "triggered_at_ist": "2026-09-12 19:30:00 IST",
        "submission_deadline_ist": "2026-09-13 19:30:00 IST",
        "submission_remaining_hours": 23.95,
        "current_status": "due_soon",
        "is_active": true
      }
    ]
  }
}
```

### `POST /api/cases/:id/clocks`
Manually initialize a statutory clock for a specific legal route.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "clock_type": "it_rules_2021_72h_standard",
  "reason": "Standard intermediary grievance submitted"
}
```

---

## 10. 14-Point Case Readiness Engine

### `GET /api/cases/:id/readiness`
Evaluates case completeness across 14 deterministic statutory and evidentiary criteria before allowing approval for platform submission.
- **Roles**: All tenant roles.
- **Response**:
```json
{
  "success": true,
  "data": {
    "is_ready": true,
    "evaluated_at": "2026-09-12T19:30:00.000Z",
    "checklist": [
      { "id": "VALID_CONTESTED_URL", "title": "Contested URL Validated", "passed": true, "blocking": true },
      { "id": "HOSTING_PLATFORM_IDENTIFIED", "title": "Hosting Platform Identified", "passed": true, "blocking": true },
      { "id": "TARGET_ENTITY_SPECIFIED", "title": "Target Entity Specified", "passed": true, "blocking": true },
      { "id": "TARGET_ENTITY_TYPE_SPECIFIED", "title": "Target Entity Type Classified", "passed": true, "blocking": true },
      { "id": "SYNTHETIC_MEDIA_TYPE_SPECIFIED", "title": "Synthetic Media Type Classified", "passed": true, "blocking": true },
      { "id": "IMPERSONATION_METHOD_SPECIFIED", "title": "Impersonation Method Classified", "passed": true, "blocking": true },
      { "id": "HARM_TYPE_SPECIFIED", "title": "Harm Type Documented", "passed": true, "blocking": true },
      { "id": "TRIAGE_CLASSIFICATION_PERFORMED", "title": "Statutory Triage Performed", "passed": true, "blocking": true },
      { "id": "EVIDENCE_ARTIFACT_PRESERVED", "title": "At Least One Evidence Item Preserved", "passed": true, "blocking": true },
      { "id": "EVIDENCE_HASH_VERIFIED", "title": "Evidence Cryptographic Hashes Present", "passed": true, "blocking": true },
      { "id": "NO_ACTIVE_DELETION_REQUESTS", "title": "No Pending Deletion Requests", "passed": true, "blocking": true },
      { "id": "STATUTORY_CLOCK_RUNNING", "title": "Applicable Statutory Clock Initialized", "passed": true, "blocking": false },
      { "id": "LEGAL_REVIEW_SATISFIED", "title": "Legal Review Requirement Satisfied", "passed": true, "blocking": true },
      { "id": "FACTUAL_BASIS_PROVIDED", "title": "Defamation/Harm Factual Basis Provided", "passed": true, "blocking": true }
    ],
    "missing_requirements": []
  }
}
```

---

## 11. Case Approval State Machine & Separation of Duties

### `POST /api/cases/:id/approval`
Execute an audited transition in the case approval state machine.
- **States**: `draft` -> `triage_complete` -> `awaiting_legal_review` -> `legal_review_approved` -> `ready_for_submission` -> `submission_simulated` (also `rejected`, `blocked`).
- **Separation of Duties**: The user who requested legal review (`awaiting_legal_review`) **cannot** self-approve it as legal reviewer (`SEPARATION_OF_DUTIES_VIOLATION`).
- **Readiness Enforcement**: Transition to `ready_for_submission` will be blocked with `READINESS_CHECK_FAILED` if any blocking checklist items fail.
- **Request Body**:
```json
{
  "to_state": "ready_for_submission",
  "reason": "All 14 statutory criteria fulfilled and verified"
}
```

### `GET /api/cases/:id/approvals`
List chronological approval transition records and signed reviewer remarks for a case.
- **Roles**: All tenant roles.

---

## 12. Submission Packet Generation & Simulation (DRY-RUN ONLY)

### `GET /api/cases/:id/submission-packet`
Generate a preview of the canonical Section 79 / IT Rules submission packet (JSON structure, Markdown legal notice, and evidence manifest).
- **Prerequisite**: Case approval status must be `ready_for_submission` or `submission_simulated`.
- **Roles**: All tenant roles.

### `POST /api/cases/:id/simulate-submission`
Perform a controlled, safe DRY-RUN submission simulation.
- **Safety Guarantee**: Strictly ZERO external HTTP takedown requests or platform API calls.
- **Action**: Generates cryptographic SHA-256 digest of packet payload, persists record with status `'simulated'`, transitions case approval status to `submission_simulated`, and logs immutable audit event.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

---

## 13. Duplicate Incident Detection & Workflow Queue

### `GET /api/cases/:id/duplicates`
Detect matching or related incidents within the tenant based on normalized contested URLs (query tracking parameters stripped, normalized path and scheme).
- **Roles**: All tenant roles.

### `POST /api/cases/:id/duplicates/link`
Link a detected duplicate incident to the canonical primary case.
- **Roles**: `analyst`, `case_manager`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "target_case_id": "cas_canonical_987654",
  "similarity_score": 1.0,
  "match_reason": "Identical normalized URL target on instagram"
}
```

### `GET /api/workflow/tasks`
Query organization-wide operational tasks (e.g., triage review, legal review, duplicate checks).
- **Query Params**: `status`, `case_id`, `task_type`.
- **Roles**: All tenant roles.

### `POST /api/workflow/tasks`
Manually create an internal workflow task for a case.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

### `POST /api/workflow/tasks/:id/acknowledge`
Mark a workflow task as `'in_progress'`.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

### `POST /api/workflow/tasks/:id/complete`
Mark a workflow task as `'completed'`.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

### `POST /api/workflow/tasks/:id/cancel`
Cancel an active workflow task with a reason.
- **Roles**: `case_manager`, `org_owner`, `system_admin`.

- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

---

## 14. Phase 4: Platform Grievance Operations & Submission Control Plane

### 14.1 Platform Registry & Policy Endpoints

#### `GET /api/platforms`
List all supported platforms with grievance officer details, SLA commitments, notice formats, and active policy version.
- **Roles**: All tenant roles.

#### `GET /api/platforms/:id`
Fetch single platform record and policy version history.
- **Roles**: All tenant roles.

#### `POST /api/platforms/:id/policy-versions`
Record an updated policy version, grievance mechanism change, or terms update.
- **Roles**: `case_manager`, `legal_reviewer`, `org_admin`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "version_number": "2026.3-IN",
  "effective_date": "2026-09-01",
  "summary_of_changes": "Updated grievance officer contact details under IT Rules 2021",
  "source_url": "https://platform.example/terms/india-2026"
}
```

---

### 14.2 Platform Playbooks Endpoints

#### `GET /api/playbooks`
List operational playbooks with statutory grounds, SLA response times, and escalation routes.
- **Roles**: All tenant roles.

#### `GET /api/playbooks/:id`
Fetch specific playbook details and required evidence types.
- **Roles**: All tenant roles.

---

### 14.3 Submission Control Plane Endpoints

#### `POST /api/submissions`
Create a draft submission packet bound to a case and platform. Validates case readiness gates.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "case_id": "cas_apex_01",
  "platform_id": "meta_instagram",
  "playbook_id": "meta_deepfake_celeb"
}
```

#### `GET /api/submissions/:id`
Fetch submission record with full multi-faceted approval matrix and response history.
- **Roles**: All tenant roles.

#### `GET /api/submissions/cases/:caseId`
List all submissions associated with a specific case.
- **Roles**: All tenant roles.

#### `POST /api/submissions/:id/transition`
Trigger manual state transition across the 11-stage grievance state machine.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "to_status": "ready_for_review",
  "reason": "Initial packet drafted and readiness checklist validated"
}
```

#### `POST /api/submissions/:id/approve`
Record multi-faceted sign-off (`evidence_sufficiency`, `legal_sufficiency`, `platform_route_selection`, `simulated_submission`).
- **Enforces**: Cryptographic SHA-256 packet hash binding, strict separation of duties (creator cannot self-approve `legal_sufficiency` or `simulated_submission`), and role-specific permissions.
- **Roles**:
  - `evidence_sufficiency`: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
  - `legal_sufficiency`: `legal_reviewer`, `org_owner`, `system_admin`.
  - `platform_route_selection`: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
  - `simulated_submission`: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "approval_type": "legal_sufficiency",
  "decision": "approved",
  "justification": "Verified IT Rules 2021 Rule 3(2)(b) compliance and statutory grounds",
  "packet_hash_signed": "b8f2...e31a"
}
```

#### `POST /api/submissions/:id/simulate`
Execute deterministic dry-run submission using `LocalDryRunSubmissionAdapter`.
- **Safety**: Generates deterministic reference (`SIM-<PLATFORM>-<YEAR>-<HASH>`); zero external network calls; zero mutations on platform APIs.
- **Requires**: Submission in `approved_for_simulation` state with all 4 approvals confirmed against matching packet hash.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.

#### `POST /api/submissions/:id/acknowledgement`
Record formal platform acknowledgement under IT Rules 2021 Rule 3(2)(a) (24-hour statutory receipt).
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "platform_reference_number": "META-CASE-9812739",
  "grievance_officer_name": "Designated Grievance Officer, Meta India",
  "acknowledgement_received_at": "2026-09-12T14:30:00Z",
  "notes": "Automated receipt confirmed by platform grievance desk"
}
```

#### `POST /api/submissions/:id/decision`
Record platform takedown determination, outcome, and optional escalation flag.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "response_category": "content_removed",
  "takedown_result": "removed",
  "platform_reference_number": "META-CASE-9812739",
  "escalation_required": false,
  "notes": "Infringing deepfake video taken down across India endpoints"
}
```

---

### 14.4 Escalation Tracking Endpoints

#### `POST /api/escalations`
Initiate formal escalation for an unresolved or rejected incident.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "case_id": "cas_apex_01",
  "severity": "critical_statutory",
  "escalation_trigger": "statutory_clock_breach",
  "recommended_action": "gac_appeal",
  "target_authority_or_court": "Grievance Appellate Committee (Panel 1)",
  "factual_summary": "Meta failed to take down intimate synthetic media within 24 hours under Rule 3(2)(b)"
}
```

#### `GET /api/escalations`
List all case escalations for the tenant.
- **Roles**: All tenant roles.

#### `GET /api/escalations/cases/:caseId`
List escalations for a specific case.
- **Roles**: All tenant roles.

#### `POST /api/escalations/:id/resolve`
Record resolution notes and mark escalation resolved.
- **Roles**: `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "resolution_notes": "GAC appeal filed successfully; interim order granted"
}
```

---

### 14.5 Related Content & Re-Upload Monitoring Endpoints

#### `POST /api/re-uploads`
Register metadata-only observation of contested mirror or suspected re-upload URL. Strips URL tracking parameters.
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "case_id": "cas_apex_01",
  "observed_url": "https://instagram.example/reel/999888?utm_source=share&igsh=123",
  "platform_id": "meta_instagram",
  "relationship": "exact_reupload",
  "target_entity": "Dr. Anand Verma",
  "similarity_score": 0.98,
  "operator_notes": "Mirror upload with identical caption and audio clone"
}
```

#### `GET /api/re-uploads`
List all registered related content observations for the tenant.
- **Roles**: All tenant roles.

#### `GET /api/re-uploads/cases/:caseId`
List observations linked to a specific case.
- **Roles**: All tenant roles.

#### `POST /api/re-uploads/:id/status`
Update observation status (`investigating`, `confirmed_infringing`, `false_positive`, `removed`).
- **Roles**: `analyst`, `case_manager`, `legal_reviewer`, `org_owner`, `system_admin`.
- **Request Body**:
```json
{
  "status": "confirmed_infringing"
}
```

---

## 15. Standard Error Responses

All error responses adhere to the standard envelope format:

```json
{
  "success": false,
  "error": {
    "code": "SEPARATION_OF_DUTIES_VIOLATION",
    "message": "Separation of duties violation: The user who requested legal review cannot self-approve it. An independent reviewer is required.",
    "details": {}
  }
}
```

### Key Error Codes
| Code | HTTP Status | Description |
| :--- | :--- | :--- |
| `HEADER_AUTH_DISALLOWED` | 401 | Header authentication (`x-user-id`) attempted in production mode. |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token. |
| `EVIDENCE_ACCESS_DENIED` | 403 | RBAC permission violation or two-person approval rule violation. |
| `ROLE_UNAUTHORIZED` | 403 | Actor role is not permitted to perform the requested workflow action. |
| `SEPARATION_OF_DUTIES_VIOLATION` | 403 | Conflict of interest: Requester cannot self-approve legal review. |
| `LEGAL_ROLE_REQUIRED` | 403 | Action specifically requires Legal Reviewer or Org Owner credentials. |
| `EVIDENCE_NOT_FOUND` | 404 | Evidence item does not exist or belongs to another tenant. |
| `CASE_NOT_FOUND` | 404 | Target case does not exist or belongs to another tenant. |
| `CLOCK_NOT_FOUND` | 404 | Statutory clock does not exist or belongs to another tenant. |
| `TASK_NOT_FOUND` | 404 | Workflow task does not exist or belongs to another tenant. |
| `SSRF_DETECTED` | 400 | Disallowed host, private IP range, or cloud metadata target in URL. |
| `EXECUTABLE_REJECTED` | 400 | Prohibited executable file type or malicious header detected. |
| `MIME_MISMATCH` | 400 | Declared Content-Type conflicts with magic byte sniffing. |
| `FILE_TOO_LARGE` | 400 | Payload exceeds category ceiling (50MB image/text, 100MB audio, 500MB video/PDF). |
| `LEGAL_HOLD_ACTIVE` | 409 | Modification or deletion blocked by active retention hold. |
| `EVIDENCE_DELETED` | 410 | Resource has been tombstoned and payload purged. |
| `INVALID_STATE_TRANSITION` | 422 | Disallowed state transition requested. |
| `INVALID_APPROVAL_TRANSITION` | 422 | Target approval state is not reachable from current approval state. |
| `READINESS_CHECK_FAILED` | 422 | Case cannot advance: blocking readiness criteria remain unfulfilled. |
| `PACKET_NOT_READY` | 422 | Submission packet generation requires ready_for_submission approval. |
| `SUBMISSION_NOT_READY` | 422 | Submission packet has not met all 14-point readiness gates. |
| `HASH_MISMATCH` | 422 | Bound packet hash does not match current generated packet hash (packet has been modified). |
| `MISSING_APPROVALS` | 422 | Required facet approvals missing before simulated submission can be dispatched. |
| `APPROVAL_CONFLICT` | 422 | Creator cannot self-approve legal sufficiency or simulation dispatch. |
| `DELETED_EVIDENCE_INCLUDED` | 422 | Case contains deleted or quarantined evidence items. |


