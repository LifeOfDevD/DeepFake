# Implementation Roadmap & Acceptance Gates: Digital Impersonation Response Desk

This document tracks implementation progress across all verified phases. Every phase must satisfy its acceptance gate before progression.

---

## Phase 0: Repository and Environment Audit (Current)
- [x] Inspect development environment and runtimes (Node 22, npm 10, Python 3.11, Git).
- [x] Create core documentation:
  - [x] `docs/product-overview.md`
  - [x] `docs/architecture.md`
  - [x] `docs/security-model.md`
  - [x] `docs/phase-plan.md`
  - [x] `docs/decisions/0001-modular-monolith-tech-stack.md`
  - [x] `docs/decisions/0002-india-first-legal-and-platform-taxonomy.md`
  - [x] `docs/decisions/0003-human-in-the-loop-safeguards.md`
  - [x] `docs/testing-strategy.md`
- [x] Create `TODO.md` with explicit acceptance criteria.
- [x] Create `.env.example` with safe configuration keys.
- [x] Create `seeds/demo-fixtures.json` (zero real PII, synthetic test data).
- [x] Submit Phase 0 report and implementation plan for user approval.
- **Acceptance Gate**: Architecture and security principles approved by stakeholder. [PASSED]

---

## Phase 1: Foundation and Case Management
- [x] Initialize project package structure and TypeScript configuration.
- [x] Implement SQLite database layer with WAL mode, foreign keys, and migration runner.
- [x] Create database schema:
  - [x] `organizations` (Tenants)
  - [x] `users` (Accounts)
  - [x] `memberships` & `roles` (Multi-tenant RBAC)
  - [x] `cases` (Incident tickets)
  - [x] `case_categories` (India-first taxonomy)
  - [x] `case_status_history` (Deterministic state transitions)
  - [x] `case_notes` (Internal team comments)
  - [x] `audit_events` (Append-only audit ledger)
- [x] Implement authentication and session management.
- [x] Build Role-Based Access Control (RBAC) middleware:
  - `system_admin`, `org_owner`, `org_admin`, `case_manager`, `analyst`, `legal_reviewer`, `read_only_stakeholder`.
- [x] Implement Case Lifecycle State Machine:
  - `new` -> `triage` -> `awaiting_authority` -> `evidence_collection` -> `human_review` -> `ready_for_submission` -> `submitted` -> `awaiting_response` -> `escalated` -> `resolved` / `closed` / `rejected` / `blocked`.
- [x] Implement Case Management API endpoints:
  - `POST /api/cases` (Create case)
  - `GET /api/cases` (Filterable case list, tenant scoped)
  - `GET /api/cases/:id` (Case detail with timeline)
  - `PATCH /api/cases/:id/status` (State transition with audit logging)
  - `POST /api/cases/:id/notes` (Internal comments)
  - `GET /api/audit-events` (Audit log inspection)
- [x] Build calm, high-density operational web UI:
  - Case list with severity badges, category, status, and SLA counters.
  - Case detail view with metadata panel, interactive state stepper, and activity history.
  - Organization switcher and user role indicators.
- [x] Seed script with realistic synthetic demo cases:
  - Cloned doctor endorsement (synthetic video).
  - Fake brand support account on Telegram.
  - Typosquat domain targeting financial institution.
  - Excluded sensitive case fixture testing quarantine state.
- [x] Test Suite:
  - [x] User A cannot view Organization B's cases (Tenant Isolation).
  - [x] Analyst cannot change status to `submitted` (RBAC enforcement).
  - [x] Every mutation creates an immutable record in `audit_events`.
  - [x] Deleting a user retains historical audit records.
  - [x] State machine rejects invalid transitions.
- **Acceptance Gate**: All unit, integration, and security tests pass. Safe demo reset verified. [PASSED]

---

## Phase 2: Evidence Locker (COMPLETED & VERIFIED)
- [x] Secure multipart upload handler with file size limits.
- [x] File type & MIME validation with executable rejection (.exe, .bat, .sh).
- [x] Streaming SHA-256 hash generation and verification.
- [x] Physical segregation: Tenant-isolated storage namespaces with path traversal defense.
- [x] Time-limited HMAC-signed temporary download URLs (300s TTL).
- [x] `evidence_items`, `evidence_access_events`, and `evidence_retention_holds` tables.
- [x] Retention date calculation and two-person deletion workflow.
- [x] Statutory quarantine with strict preview suppression for prohibited content.
- [x] Operational UI: Evidence Locker tab, drag-and-drop dropzone, URL intake, and item inspector.
- **Acceptance Gate**: Hash verification matches byte-for-byte; cross-tenant download rejected; expired tokens fail; downloads generate audit entries; 58/58 tests pass. [PASSED]

---

## Phase 3: Authority, Consent, and Case Classification
- [ ] Identity proof and authorization management (`authorized_representatives`, `official_profiles`).
- [ ] 10-step classification wizard mapping to Indian statutes (IT Act 66C/66D/66E, IT Rules 2021 Rule 3, BNS 2023, Copyright 1957).
- [ ] Versioned policy repository (`policy_rules`, `policy_sources`).
- [ ] Automatic CSAM / NCII quarantine intercept and emergency NCRP routing.
- [ ] Human approval gate for legal routing and complainant authority.
- **Acceptance Gate**: Cases cannot advance without verified authority; excluded cases enter emergency quarantine.

---

## Phase 4: Notice and Response Workflow
- [ ] Legal notice & takedown petition drafting engine.
- [ ] Notice lifecycle states (`draft`, `human_reviewed`, `approved_for_submission`, `submitted`, `rejected`, `superseded`).
- [ ] `ExternalActionAdapter` interface and `DryRunExternalActionAdapter`.
- [ ] Simulation of all platform response states (success, duplicate, invalid evidence, rate limited, platform down).
- [ ] Cryptographic action approval log.
- **Acceptance Gate**: Zero submissions possible without prior approved action record; dry-run mode safely handles all error codes.

---

## Phase 5: Monitoring and Detection Adapters
- [ ] Provider-neutral detector adapter architecture.
- [ ] Advisory score calculation and UI uncertainty markers.
- [ ] Ingestion deduplication engine (merging recurring URLs into single cases).
- [ ] Adapter failure and timeout resilience.
- **Acceptance Gate**: Identical URLs deduplicate; low-confidence scores marked uncertain; provider failure does not crash workflow.

---

## Phase 6: Timers, Escalations, and Re-Upload Monitoring
- [ ] Dual clock engine: IT Rules 2021 statutory clocks (24hr / 72hr) vs. operational SLA clocks.
- [ ] Multi-tier escalation ladder (L1 Analyst -> L2 Manager -> L3 RGO Grievance -> L4 GAC / NCRP).
- [ ] Overdue case dashboard with calm color-coded alerts.
- [ ] Re-upload matching engine across multiple monitored platforms.
- **Acceptance Gate**: Accurate calendar clock calculations; automated escalation triggering without false legal claims.

---

## Phase 7: Customer Portal and Reporting
- [ ] Read-only client stakeholder portal.
- [ ] Incident dossier PDF / Markdown generator with cryptographic hash manifest and timeline.
- [ ] Retention management and authorized contact controls.
- **Acceptance Gate**: Reports exclude sensitive third-party materials; customer views display transparent status.

---

## Phase 8: Production Hardening
- [ ] Rate limiting, CSRF tokens, and security headers (CSP, HSTS).
- [ ] Database backup and automated recovery testing.
- [ ] Threat model validation and OWASP Top 10 regression testing.
- [ ] Complete compliance bundle: Privacy Policy, Terms of Service, DPA, Subprocessor Directory.
- **Acceptance Gate**: 100% test pass rate across all 10 testing layers; zero high/critical vulnerabilities.
