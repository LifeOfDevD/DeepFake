# Digital Impersonation Response Desk: Phased Implementation Plan

This roadmap defines the 8 development phases for the Digital Impersonation Response Desk. Each phase possesses an explicit acceptance gate that must pass before progression.

---

## Phase 1: Foundation and Case Management (COMPLETED & VERIFIED)
- **Objective**: Establish the core modular monolith architecture, database persistence, tenant isolation, authentication, RBAC, case lifecycle state machine, audit logging, and operational dashboard.
- **Deliverables**:
  - Modular project structure (`src/db`, `src/domain`, `src/services`, `src/middleware`, `src/routes`, `src/client`).
  - Database schema & migration engine (SQLite WAL mode, strict foreign keys).
  - Multi-tenant auth, session tokens, user invitations, and RBAC middleware.
  - Case management endpoints: Create, List, Detail, Status Transition, Priority, Categorization, Internal Comments, Activity Timeline.
  - Append-only audit logger tracking every mutation.
  - Calm, accessible web dashboard for case operators.
  - Comprehensive unit and integration test suite (20 tests passed).
  - Safe demo seed dataset (zero real PII).
- **Acceptance Gate**: All criteria verified and passed.

---

## Phase 2: Evidence Locker Subsystem (COMPLETED & VERIFIED)
- **Objective**: Build a tamper-evident evidence vault supporting file uploads, URL capture, metadata extraction, SHA-256 integrity verification, signed temporary access URLs, and chain-of-custody logging.
- **Deliverables**:
  - `EvidenceStorage` abstraction (`LocalEvidenceStorage` with atomic temp-writes and path normalization, `InMemoryEvidenceStorage` for tests).
  - Single-pass streaming SHA-256 calculation and magic-byte MIME detection (`src/services/evidence-hasher.ts`).
  - Executable rejection (`.exe`, `.bat`, `.sh`, `.cmd`, `.msi`, `.elf`) and size ceilings (50MB image, 500MB video).
  - Manual source URL intake with SSRF/localhost blocking and zero live network fetching (`src/services/source-capture.ts`).
  - Ephemeral HMAC-SHA256 download token generator and verifier (300s TTL).
  - Legal Hold hard locking (`evidence_retention_holds`) and two-person deletion rule (`deletion_requested` -> `deletion_approved`).
  - Statutory quarantine and complete preview suppression for prohibited items with NCRP/1930 advisory.
  - Operational web UI integration: Evidence Locker sub-tab, upload dropzone, URL intake, roster table, item inspector, chain-of-custody ledger.
  - Comprehensive test suite: 58 tests across 12 suites (100% pass rate).
- **Acceptance Gate**: All criteria verified and passed.

---

## Phase 3: Authority, Consent, and Case Classification
- **Objective**: Build structured claimant verification, authorization proof management, and India-specific legal/policy classification with versioned statutory rules.
- **Deliverables**:
  - Claimant identity and authority proof registry (`authorized_representatives`, `official_profiles`, trademark/tradename records).
  - 10-step classification workflow engine mapping incidents to statutory grounds (IT Act 66C/66D/66E, IT Rules 2021 Rule 3, BNS 2023, Copyright 1957).
  - Versioned policy database with effective dates, regulatory triggers, and required evidence checklists.
  - Excluded incident detection (CSAM/NCII quarantine and NCRP escalation router).
  - Human review approval gate for category and escalation path selection.
- **Acceptance Gate**:
  - Case cannot proceed past `awaiting_authority` without verified authority documentation.
  - Policy rules link directly to statutory citations and effective dates.
  - Excluded cases immediately lock down and trigger emergency law enforcement guidance.

---

## Phase 4: Notice and Response Workflow
- **Objective**: Create a legal notice drafting engine, platform takedown petition generator, human approval gate, and dry-run external action adapter.
- **Deliverables**:
  - Structured notice builder compiling incident facts, affected party identity, official handles, contested URLs, statutory basis, and proof index.
  - Notice status lifecycle: `draft` -> `human_reviewed` -> `approved_for_submission` -> `submitted` -> `rejected`/`superseded`.
  - Pluggable `ExternalActionAdapter` interface (`validate`, `preview`, `submit`, `getStatus`, `cancel`).
  - `DryRunExternalActionAdapter` simulating platform response codes (submitted, duplicate, invalid evidence, rate limited, etc.).
  - Action approval cryptographic signing and audit trail.
- **Acceptance Gate**:
  - No notice can be submitted without an `approved_for_submission` record signed by an authorized reviewer.
  - Dry-run adapter faithfully handles all simulated platform failure modes without corrupting case state.
  - Live external platform actions remain disabled by default.

---

## Phase 5: Monitoring and Detection Adapters
- **Objective**: Implement provider-neutral interfaces for synthetic media detection, public URL monitoring, and alert deduplication.
- **Deliverables**:
  - Detector adapter interface storing provider, model, confidence score, input hash, limitations, and costs.
  - Mock detectors for deepfake video, cloned voice, and domain typosquatting.
  - Deduplication engine merging recurring signals into existing incidents rather than creating duplicate cases.
  - UI visual badges distinguishing between verified facts and probabilistic detector outputs.
- **Acceptance Gate**:
  - Identical contested URLs map to existing cases rather than generating duplicate records.
  - Low-confidence detector scores are visibly marked as uncertain in the UI.
  - Detector failure or timeout degrades gracefully without halting case workflow.

---

## Phase 6: Timers, Escalations, and Re-Upload Monitoring
- **Objective**: Implement India IT Rules 2021 statutory clocks (24hr / 72hr), business SLA timers, automated escalation ladders, and re-upload tracking.
- **Deliverables**:
  - Dual timer engine: Statutory calendar clocks vs. Operational business-hours clocks.
  - Automated escalation engine: L1 Analyst -> L2 Manager -> L3 Legal Grievance -> L4 GAC / Police.
  - Overdue-case queue with visual alerts.
  - Re-upload fingerprint matcher tracking contested media across multiple platforms.
- **Acceptance Gate**:
  - Timers compute accurately across timezone boundaries (IST / UTC).
  - Breached response windows trigger escalation alerts without asserting false claims of legal culpability.

---

## Phase 7: Customer Portal and Reporting
- **Objective**: Deliver a calm, executive-ready client portal for case tracking, authority submissions, and downloadable evidence dossiers.
- **Deliverables**:
  - Client dashboard showing active incidents, pending approvals, and resolution status.
  - Audit-grade incident PDF / Markdown report generator with SHA-256 evidence indexes and chain of custody.
  - Client retention settings and authorized contact management.
- **Acceptance Gate**:
  - Downloadable reports exclude raw sensitive or unauthorized materials.
  - Stakeholder views restrict internal notes while displaying verified public platform status.

---

## Phase 8: Production Hardening
- **Objective**: Comprehensive security auditing, rate limiting, penetration testing, database backup automation, and compliance documentation.
- **Deliverables**:
  - Rate limiting on API routes and authentication endpoints.
  - CSRF protection, Content Security Policy (CSP), and secure HTTP headers.
  - Automated database backup and point-in-time recovery verification scripts.
  - Threat model validation and automated security regression test suite.
  - Compliance documentation: Privacy Policy, Terms of Service, DPA, and Subprocessors list.
- **Acceptance Gate**:
  - OWASP Top 10 automated security scan passes.
  - Database restore test successfully recovers seeded state.
  - Zero critical or high vulnerabilities in dependencies.
