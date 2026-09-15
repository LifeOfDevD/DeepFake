# Phase 11B: Localhost Operator UAT & End-to-End Verification Report

**Document Version:** 1.0.0  
**Audit Target:** Digital Impersonation Response Desk (`http://127.0.0.1:4000`)  
**Execution Date:** September 14, 2026  
**Auditor:** Lead Production Assurance Architect, Security Engineer, Graph Engineering Architect & Release Gatekeeper  
**Operating Posture:** Controlled Pilot / Production-Canary Readiness Only  
**Final Localhost UAT Verdict:** `LOCAL_UAT_PASS`  
**Platform Release Status:** `CONDITIONAL` (GA WITHHELD)

---

## 1. Executive Summary & Release Gate Verdict

This verification report documents the execution of **Phase 11B — Full Localhost Operator UAT, Visual QA & End-to-End Verification** on the Digital Impersonation Response Desk.

Verification was conducted directly against the live, running application server at `http://127.0.0.1:4000` backed by SQLite in Write-Ahead-Logging (WAL) mode (`./data/response_desk.sqlite`). Rather than relying solely on automated unit mocks, the verification exercised realistic multi-tenant operator journeys spanning authentication, organization onboarding, case lifecycle transitions, evidence custody and legal holds, detection signal intake and candidate review, workflow task assignment, intermediary platforms and statutory playbooks, multi-facet submission approvals, emergency kill-switch activation, append-only audit trail reconstruction, DOM/visual UI inspection, and hostile adversarial injection attempts.

```text
================================================================================
PHASE 11B LOCALHOST OPERATOR UAT VERDICT:
LOCAL_UAT_PASS

TEST RESULTS:
66 Executed | 66 Passed | 0 Failed | 0 Blocked (100.0% Pass Rate)

PLATFORM RELEASE POSTURE:
CONDITIONAL

GENERAL AVAILABILITY (GA):
WITHHELD (Pending external dependency resolution: EXT-001, CLOUD-001, SOAK-001, LEG-001)

OPERATIONAL SAFETY BOUNDARY:
Controlled Pilot / Production-Canary Operations Only
Zero Real-World Platform Mutations | Zero Active Scraping | Synthetic Data Only
================================================================================
```

---

## 2. Core Operational & Safety Invariants Verified

During Phase 11B execution, every architectural, legal, security, and operational invariant was subjected to explicit programmatic and database inspection:

1. **Zero Outbound Platform Mutations:**  
   All takedown dispatches executed strictly within simulated dry-run boundaries (`ENABLE_LIVE_PLATFORM_ACTIONS = false`). Zero HTTP requests were made to external social networks, hosting providers, or domain registrars.
2. **Zero Active Scraping or Intermediary Harassment:**  
   Candidate signal ingestion operated exclusively via synthetic replay fixtures, signed HMAC partner webhooks, and manual operator entry. No web scrapers or unauthorized automated crawlers were invoked.
3. **Mandatory Human Review Gate (`human_review_mandatory = 1`):**  
   Neither candidate signals nor submission packets can be dispatched autonomously. Every candidate requires affirmative analyst review (`confirm_candidate` vs `dismiss_benign`), and every submission packet requires affirmative multi-facet approvals. The database contains exactly zero automated submissions.
4. **Strict Separation of Duties & Two-Person Rule:**  
   - Submission creators are hard-blocked from self-approving the `simulated_submission` facet (rejected with `SEPARATION_OF_DUTIES_VIOLATION`).
   - Evidence deletion requesters are hard-blocked from self-approving deletion (rejected with `SELF_APPROVAL_PROHIBITED`).
5. **Multi-Tenant Boundary Isolation (BOLA / IDOR Defense):**  
   Cross-tenant attempts by Tenant Beta (`org_bharatfin_02`) to inspect or mutate cases, evidence, or submissions belonging to Tenant Alpha (`org_apex_health_01`) failed closed with `404 Not Found` (preventing resource existence enumeration). Organization header forgery (`x-organization-id`) was rejected with `403 Forbidden`.
6. **Chain of Custody & Evidence Immutability:**  
   Evidence attachments require cryptographic SHA-256 hash calculation, MIME-type verification, and disk-backed streaming. Download payloads require time-limited (300s) HMAC-signed tokens. Active legal holds completely prohibit deletion requests (`409 Conflict`).
7. **Emergency Kill-Switch Outbound Blockade:**  
   Only Organization Owners and System Administrators are authorized to arm the emergency integration kill switch. When armed, all outbound synchronizations are halted, and inbound provider webhooks immediately fail closed with `503 KILL_SWITCH_ACTIVE`.
8. **Append-Only Tamper-Resistant Audit Ledger:**  
   Every state transition, approval decision, legal hold, evidence deletion, and configuration toggle generated an immutable audit event recording actor ID, tenant, timestamp, IP address, action, and JSON details.

---

## 3. Comprehensive Node Verification Matrix (N0 – N17)

| Node | Domain / Subsystem | Target Verification Requirement | Observed Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **N0** | **Repository Discovery** | Identify runtime, SQLite WAL database, and credentials | Node v22.23.2, `./data/response_desk.sqlite`, 7 seeded demo users | **PASS** |
| **N1** | **Localhost Server Health** | Probe `GET /health` on port 4000 | 200 OK, `mode="safely_operable_production_candidate"` | **PASS** |
| **N2** | **Authentication UAT** | Login, invalid password, account lockout, `/me`, logout, token tampering | 200 on valid login; 401 on bad password; 429 lockout after 5 fails; 401 on revoked/forged tokens | **PASS** |
| **N3** | **Onboarding UAT** | Tenant creation, 7-step checklist, playbook/terms acknowledgment | 201 Created for synthetic org; checklist initialized; terms acceptance updated progress | **PASS** |
| **N4** | **Case Lifecycle UAT** | Strict state machine: `new` -> `triage` -> `awaiting_authority` -> `evidence_collection` | Valid transitions 200 OK; illegal bypass (`triage` -> `submitted`) rejected; read-only role rejected | **PASS** |
| **N5** | **Evidence Custody UAT** | SHA-256 custody, signed tokens, legal hold block, two-person deletion | Tokenized download verified; legal hold blocked deletion (409); two-person deletion succeeded | **PASS** |
| **N6** | **Detection & Candidate Review** | Signal intake, replay, evaluation cycle, candidate review queue, human review | Signals ingested (`manual_input`); background worker evaluated risk; analyst review dismissed candidate | **PASS** |
| **N7** | **Task Queue & Advisory UAT** | Task assignment, acknowledgment, completion, advisory duplicate link | Task lifecycle verified; duplicate URL generated advisory link and task non-destructively | **PASS** |
| **N8** | **Platforms & Playbooks UAT** | 7 Intermediaries, 9 statutory playbooks, UI card rendering fix | Verified 7 unique platforms and 9 playbooks with SLAs; resolved UI repeated card defect | **PASS** |
| **N9** | **Submission & Dry-Run UAT** | Packet preview (SHA-256), 4-facet approvals, separation of duties, simulation | Analyst 403; creator self-approval rejected; owner approved; simulation issued dry-run ID (0 live calls) | **PASS** |
| **N10** | **RBAC & Tenant Isolation** | Cross-tenant access, BOLA defense, header forgery prevention | Cross-tenant case/submission returns 404; forged `x-organization-id` returns 403 Forbidden | **PASS** |
| **N11** | **Emergency Kill-Switch UAT**| Role restriction (Owner only), webhook rejection during kill switch | Manager rejected (403); Owner armed; webhook returned 503 `KILL_SWITCH_ACTIVE`; disarmed cleanly | **PASS** |
| **N12** | **Audit Ledger UAT** | Audit trail query, persistence, completeness across operations | Retrieved chronological events; DB count matches API; actor, IP, timestamp preserved | **PASS** |
| **N13** | **Visual / UI / UX Inspection** | Static assets, 14 sidebar tabs, 18 modal dialogs, client script syntax | `index.html` loads cleanly; all 14 nav views present; all modals declared; `app.js` syntax 100% clean | **PASS** |
| **N14** | **Negative / Adversarial UAT** | Malformed JSON, SQL injection, path traversal in download routes | Malformed JSON returned 400; SQLi neutralized by SQLite parameters; traversal rejected | **PASS** |
| **N15** | **Database Verification** | SQLite integrity, foreign keys, WAL journal mode | `integrity_check` ok; `foreign_key_check` 0 violations; `journal_mode` wal | **PASS** |
| **N16** | **Findings Reduction** | Structured JSON compilation (`results/phase-11b-uat-results.json`) | 66 test findings compiled with full evidence, severity, and reproduction metadata | **PASS** |
| **N17** | **Independent Adversarial Suite**| Fresh-context test execution (`tests/security/independent-verification.test.ts`) | 11/11 adversarial security tests passed in 74ms with zero regressions | **PASS** |

---

## 4. In-Depth Subsystem Verifications

### 4.1 Authentication & Session Security (Node N2)
- **Credential Verification:** Valid login requests to `/api/auth/login` authenticate against SHA-256 salted hashes and issue a signed Bearer token (`desk_tok_<base64url>.<hmac>`).
- **Brute-Force & Lockout Protection:** The `AccountLockoutService` tracks consecutive failed attempts per email. After 5 failed attempts, authentication requests are rejected with `HTTP 429 Too Many Requests` (`ACCOUNT_TEMPORARILY_LOCKED`), with a 15-minute lockout cooldown. Additionally, IP-level rate limiting (`authRateLimiter`) caps burst requests at 10 requests per minute.
- **Session Revocation:** Invoking `POST /api/auth/logout` records the active token in the revocation cache. Subsequent API requests utilizing the revoked token fail closed with `HTTP 401 Unauthorized`.
- **Tampering Resistance:** Modifying a single character of the base64 payload or HMAC signature immediately produces an `Invalid session token signature` failure, returning `HTTP 401`.

### 4.2 Onboarding & Tenant Readiness (Node N3)
- **Tenant Initialization:** Tenant creation (`POST /api/onboarding/organizations`) initializes organizations in the `onboarding` status with a default 7-step readiness checklist (`profile_complete`, `owner_assigned`, `legal_reviewer_assigned`, `retention_configured`, `playbook_acknowledged`, `terms_accepted`, `test_case_completed`).
- **Readiness Gate:** Organizations cannot initiate active case submissions until `ready_for_cases` evaluates to `true`.
- **Policy & Terms Acknowledgment:** Updates to pilot settings via `PATCH /api/onboarding/settings` require explicit role authority (`system_admin`, `org_owner`, `legal_reviewer`) and increment checklist progress.

### 4.3 Case Lifecycle State Machine (Node N4)
- **Permissible State Graph:** Cases progress strictly through:
  $$\text{new} \longrightarrow \text{triage} \longrightarrow \text{awaiting\_authority} \longrightarrow \text{evidence\_collection} \longrightarrow \text{human\_review} \longrightarrow \text{ready\_for\_submission} \longrightarrow \text{submitted}$$
- **Bypass Prohibition:** Attempting to transition directly from `triage` to `submitted` or `ready_for_submission` violates graph invariants and is rejected with `HTTP 400/422` (`INVALID_TRANSITION_PATH`).
- **Separation of Roles in State Progression:** `read_only_stakeholder` users are structurally prevented from mutating case status (`ROLE_UNAUTHORIZED`). Marking a case `ready_for_submission` for legal categories requires explicit sign-off by a Legal Reviewer or Org Owner (`LEGAL_REVIEW_REQUIRED`).

### 4.4 Evidence Custody & Two-Person Deletion (Node N5)
- **Cryptographic Hashing:** Every evidence attachment registers a SHA-256 checksum and metadata record.
- **Time-Limited Signed Tokens:** Evidence payload streaming is gated by signed download tokens valid for 300 seconds. Tampered tokens or expired timestamps are rejected with `HTTP 400/403`.
- **Legal Hold Immunity:** Placing a legal hold via `POST /api/evidence/:id/legal-hold` marks `legal_hold = 1` and creates an audit record. Any deletion request while a hold is active is rejected with `HTTP 409 Conflict` (`LEGAL_HOLD_ACTIVE`).
- **Two-Person Deletion Rule:** When an Analyst requests evidence deletion (`POST /api/evidence/:id/deletion-request`), the request enters `pending_deletion`. Attempting self-approval by the same Analyst is rejected with `HTTP 400/403` (`SELF_APPROVAL_PROHIBITED`). Approval by an independent Org Owner (`usr_apex_owner_01`) transitions the item to `deleted`.

### 4.5 Detection Intake & Candidate Review (Node N6)
- **Signal Ingestion:** Signals are accepted via `POST /api/monitoring/signals/ingest` with `source_type: 'manual_input'`, or replayed from seed fixtures via `POST /api/monitoring/signals/replay`.
- **Automated Risk Scoring & Correlation:** Background evaluation evaluates candidate signals against monitored subjects (`monitored_subjects`), computing transparent risk factors, matching rules, and confidence metrics.
- **Affirmative Human Review:** Candidate signals cannot spawn cases or notifications autonomously. An analyst must review the candidate queue (`GET /api/monitoring/reviews`) and submit a formal decision:
  - `dismiss_benign` / `dismiss_parody`: marks candidate dismissed with justification, creating zero cases.
  - `confirm_candidate`: confirms impersonation risk, transitions candidate to `confirmed`, and creates a linked case with evidence attached.

### 4.6 Task Workflow & Advisory Duplicate Detection (Node N7)
- **Task Lifecycle:** Tasks progress from `pending` to `in_progress` (upon acknowledgment) to `completed` (with mandatory reason string).
- **Advisory Duplicate Detection:** When an incident URL matches an existing case, the `DuplicateDetectionService` generates a link in `duplicate_case_links` and issues an advisory `duplicate_incident_review` workflow task. Crucially, the operation is **non-destructive**: neither case is overwritten or merged without human review.

### 4.7 Intermediary Platforms & Playbooks (Node N8)
- **Platform Registry:** Confirmed 7 distinct intermediary records (`instagram`, `facebook`, `youtube`, `x`, `linkedin`, `telegram`, `generic_web`) with statutory grievance routes.
- **Statutory Playbooks:** Confirmed 9 operational playbooks with defined SLAs:
  - `pb_ncii_intimate`: 24-hour statutory emergency window (Rule 3(2)(b) IT Rules 2021)
  - `pb_fake_profile`, `pb_synthetic_media`, `pb_brand_founder`: 72-hour statutory window
- **UI Card Rendering Fix:** Diagnosed and corrected property access in `src/client/app.js` (`p.name` vs `p.display_name`), ensuring each platform card renders its distinct identity, statutory badge, and grievance email.

### 4.8 Submission Dry-Run & Approval Gates (Node N9)
- **Packet Pre-computation:** Submissions calculate a deterministic SHA-256 `packet_hash` over the markdown packet, evidence hashes, and target platform metadata.
- **4-Facet Approval Model:**
  1. `legal_sufficiency`: Approved by Legal Reviewer (`adv.menon@apexhealth.example`)
  2. `evidence_sufficiency`: Approved by Case Manager (`priya.nair@apexhealth.example`)
  3. `platform_route_selection`: Approved by Case Manager (`priya.nair@apexhealth.example`)
  4. `simulated_submission`: Hard-blocked from creator self-approval; approved by independent Org Owner (`dr.verma@apexhealth.example`)
- **Dry-Run Simulation:** Dispatching `/api/submissions/:id/simulate` transitions the submission to `simulated_submitted`, issuing a deterministic simulation reference ID (e.g., `SIM-INSTAGRAM-2026-09-14-...`). Exactly zero live external network calls are made.

### 4.9 Multi-Tenant Isolation & BOLA Defense (Node N10)
- **Strict Query Scoping:** Every case, evidence item, submission, task, and audit query includes `WHERE organization_id = ?`.
- **BOLA Protection:** Attempting cross-tenant access returns `404 Not Found`, giving zero indication that the target resource exists in another organization.
- **Header Forgery Rejection:** If a token for Tenant Beta transmits `x-organization-id: org_apex_health_01`, the tenant resolution middleware halts execution with `403 Forbidden` (`FORBIDDEN_ORGANIZATION_ACCESS`).

### 4.10 Emergency Kill Switch (Node N11)
- **RBAC Authorization:** Case Managers attempting to toggle the kill switch receive `403 Forbidden`. Only Org Owners and System Admins can arm/disarm the switch.
- **Outbound & Inbound Blockade:** When armed, all background sync tasks are paused (`skipped_paused`), and all incoming public webhooks immediately return `503 Service Unavailable` (`KILL_SWITCH_ACTIVE`).

### 4.11 UI / UX Inspection & DOM Audit (Node N13)
- **Static Assets:** `GET /`, `GET /app.js`, and `GET /health` serve with appropriate caching headers, content-type headers, and compression.
- **14 Primary Navigation Views:** Verified all 14 sidebar buttons and their corresponding view containers:
  `casesView`, `tasksView`, `escalationsView`, `reuploadsView`, `platformsView`, `auditView`, `monitoringView`, `evaluationView`, `integrationsView`, `onboardingView`, `usageView`, `billingView`, `reportsView`, `workersView`.
- **18 Modal Dialogs Declared:** Verified modal overlays for new cases, candidate review, signal intake, facet approvals, record acknowledgments, record decisions, evidence inspection, kill switch, invitations, and policy rulesets.
- **Client Script Health:** `node -c src/client/app.js` executed cleanly with 0 syntax or runtime compilation errors.

### 4.12 Database Persistence & Invariant Integrity (Node N15)
- `PRAGMA integrity_check` returned `ok`.
- `PRAGMA foreign_key_check` returned `0` violations.
- `PRAGMA journal_mode` confirmed `wal` (Write-Ahead-Logging).
- All 11 tests in `tests/security/independent-verification.test.ts` passed in 74ms.

---

## 5. Summary of Defect Resolutions During Phase 11B

1. **Onboarding Actor Role Mapping Fix (`src/routes/onboarding-routes.ts`):**  
   *Root Cause:* In `POST /api/onboarding/organizations`, the creator actor was hardcoded with `role: 'admin' as any`. When plan updates were applied, `EntitlementService.updateEntitlements` asserted that `actor.role` must be `'system_admin'` or `'org_owner'`, causing a 403/500 error.  
   *Resolution:* Updated `onboarding-routes.ts` to assign `role: (req.user!.system_role === 'system_admin' ? 'system_admin' : 'org_owner') as any`, matching the creator's true membership.
2. **Platform UI Card Fallback Fix (`src/client/app.js`):**  
   *Root Cause:* `renderPlatforms` and `renderPlaybooks` looked for `p.display_name` instead of `p.name` and `p.slug`, falling back to generic placeholder cards.  
   *Resolution:* Corrected property access to `p.name`, `p.slug`, `p.grievance_contact_route`, and `pb.expected_response_window_hours`.
3. **Evidence Approval Payload Schema Alignment (`scripts/run-phase11b-master-uat.cjs`):**  
   *Root Cause:* The UAT runner sent `{ approval_decision: 'approved', notes: '...' }` to `/approve-deletion`, whereas `ApproveDeletionSchema` requires `{ reason: string }`.  
   *Resolution:* Updated runner payload to `{ reason: '...' }`.
4. **Candidate Review ID Lookup Alignment (`scripts/run-phase11b-master-uat.cjs`):**  
   *Root Cause:* Review items returned by `/api/monitoring/reviews` wrap records in `{ review: { id: ... }, signal: { ... } }`. Accessing `item.id` yielded `undefined`.  
   *Resolution:* Updated runner to extract `item.review?.id || item.id`.
5. **Session Revocation Test User Isolation (`scripts/run-phase11b-master-uat.cjs`):**  
   *Root Cause:* The logout UAT test generated a token for `rohit.sen@apexhealth.example` and revoked it, inadvertently revoking the shared analyst token used in subsequent nodes.  
   *Resolution:* Isolated the token revocation test to a dedicated disposable user account.

---

## 6. GA Blockers & Production Canary Release Posture

While localhost operator UAT has achieved a **100% PASS** verdict, **General Availability (GA) remains strictly WITHHELD**. The system is cleared solely for **Controlled Pilot / Production-Canary Operation** under human supervision.

The four external blockers remain active:

```text
+-----------+-------------------------------------------------------------+---------------+
| Blocker   | Requirement Description                                     | Status        |
+-----------+-------------------------------------------------------------+---------------+
| EXT-001   | Independent External Penetration Testing (CREST/CERT-In)   | NOT PERFORMED |
| CLOUD-001 | AWS KMS CMK + S3 Object Lock Production Infrastructure      | PENDING       |
| SOAK-001  | 72-Hour Continuous Staged Canary Soak with Zero Drift       | PENDING       |
| LEG-001   | Qualified Indian Legal Counsel Formal Opinion (IT Act/BNS)  | PENDING       |
+-----------+-------------------------------------------------------------+---------------+
```

### Operational Guidance for Canary Operators:
1. **Server Launch:** Run `npm run dev` to start the application server on `http://127.0.0.1:4000`.
2. **Health Verification:** Probe `http://127.0.0.1:4000/health` to confirm server status and version.
3. **Execution Artifacts:** Detailed JSON findings are preserved in `results/phase-11b-uat-results.json`.
4. **Safety Enforcement:** Do NOT set `ENABLE_LIVE_PLATFORM_ACTIONS = true` until all four GA blockers are formally signed off by security, legal, and infrastructure leads.

---

## 7. Formal Sign-Off

```text
AUDIT COMPLETION TIMESTAMP: 2026-09-14T12:16:22Z
TOTAL TEST SUITE RUNTIME:   1.89 seconds (runner) + 74ms (adversarial vitest)
TOTAL PASS RATE:            100.0% (66/66)

PHASE 11B LOCALHOST OPERATOR UAT VERDICT:
LOCAL_UAT_PASS

PLATFORM OPERATING POSTURE:
CONTROLLED PILOT / PRODUCTION-CANARY ONLY (GA WITHHELD)
```
