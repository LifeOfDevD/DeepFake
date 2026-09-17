# Repository Inventory: Digital Impersonation Response Desk

**Date:** September 17, 2026  
**Release Baseline:** `v1.0.0-controlled-pilot-rc2`  
**Git Commit:** `e7db64ce58111a6a5f1bbf6b49d0b3e6dc6fb2db`  
**Git Working Tree:** Clean  
**Operating Posture:** Controlled Pilot / Production-Canary Only  
**General Availability:** Strictly Withheld (Pending External Assurance)  

---

## 1. Executive Summary & Inventory Purpose

This document provides a comprehensive, ground-truth inventory of the **Digital Impersonation Response Desk** codebase, tests, documentation, infrastructure definitions, and git artifacts. It serves as the authoritative baseline for repository structure design, public portfolio presentation, and security audits.

---

## 2. Source Code Inventory (`src/`)

The application is implemented as a modular, type-safe Node.js / TypeScript service (`Node 22`, `Express 4.21`, `better-sqlite3 11.8`, `TypeScript 5.8`).

### 2.1 Core Application Lifecycle
* `src/server.ts`: HTTP server initialization, environment bootstrapper, port binding, and process lifecycle management.
* `src/app.ts`: Express application setup, security middleware mounting (Helmet, CORS, body parsers), request context initialization, route registry, error handling pipeline, and worker initialization.

### 2.2 Configuration & Environment (`src/config/`)
* `src/config/env.ts`: Strict Zod schema configuration validation. Enforces fail-closed rules in production mode (rejects weak secrets, validates 32+ character secrets, rejects `dev_`/`test_` prefixes, validates storage backend).
* `src/config/plans.ts`: Multi-tenant subscription plans and quota definitions (Pilot, Growth, Enterprise) controlling case quotas, evidence storage limits, and SLA guarantees.

### 2.3 Database & Migrations (`src/db/`)
* `src/db/connection.ts`: `better-sqlite3` instance manager enforcing Write-Ahead Logging (`wal` mode), foreign key constraints (`PRAGMA foreign_keys = ON`), and connection pooling.
* `src/db/migrate.ts`: Deterministic schema migration runner with transactional execution and migration ledger tracking.
* `src/db/schema.sql`: Full DDL specification across 36 relational tables.
* `src/db/seed.ts`: Deterministic synthetic seed generator creating isolated organizations, users, test cases, and monitoring signals.
* `src/db/migrations/`:
  - `0001_initial_schema.sql`: Foundational organizations, users, cases, and audit ledger.
  - `0002_evidence_locker.sql`: Forensic evidence vault, SHA-256 metadata, custody log.
  - `0003_evidence_hardening.sql`: WORM retention flags, legal hold status, two-person deletion tracking.
  - `0004_phase3_intake_triage_workflow.sql`: Incident intake, triage scoring, statutory clock timers.
  - `0005_phase4_grievance_operations.sql`: Platform playbooks, submission packets, multi-facet approvals.
  - `0006_phase5_pilot_saas.sql`: Multi-tenant billing ledger, usage metering, subscription quotas.
  - `0007_phase6_monitoring_detection.sql`: Signal ingestion, candidate review, correlation engine, subject registry.
  - `0008_phase7_evaluation_quality.sql`: Ruleset versioning, intelligence provider adjudication, privacy review.
  - `0009_phase8_controlled_integrations.sql`: Provider OAuth tokens, webhook ledger, circuit breakers, kill switch.

### 2.4 Domain State Machines & Invariants (`src/domain/`)
* `src/domain/state-machine.ts`: Case lifecycle state machine (`intake` → `triage` → `evidence_collection` → `playbook_selection` → `notice_drafting` → `submitted` → `monitoring` → `resolved`).
* `src/domain/evidence-state-machine.ts`: Forensic evidence lifecycle (`draft` → `staged` → `hashed` → `locked` → `archived` → `quarantined`).
* `src/domain/submission-state-machine.ts`: Takedown submission lifecycle with multi-facet approval gates (`draft` → `pending_legal` → `pending_evidence` → `approved` → `simulated_submitted` → `dispatched`).
* `src/domain/approval-state-machine.ts`: Multi-role approval tracker enforcing separation of duty.
* `src/domain/submission-adapter.ts`: Formats platform-specific grievance payloads (Meta, YouTube, X, Telegram, LinkedIn).
* `src/domain/types.ts`: Comprehensive domain interfaces and TypeScript type definitions.

### 2.5 Middleware & Security Pipeline (`src/middleware/`)
* `src/middleware/auth.ts`: Authentication middleware verifying HMAC Bearer session tokens, extracting actor metadata, and enforcing session expiry.
* `src/middleware/rbac.ts`: Role-Based Access Control enforcing permissions across 6 roles (`CaseManager`, `LegalCounsel`, `EvidenceSpecialist`, `Analyst`, `OrgAdmin`, `SystemAdmin`).
* `src/middleware/tenant.ts`: Multi-tenant isolation middleware guaranteeing that queries are parameterized with `organization_id`. Defeats BOLA / IDOR vulnerabilities.
* `src/middleware/request-context.ts`: Correlates incoming HTTP requests with a unique `requestId` and audit context.
* `src/middleware/error-handler.ts`: Centralized error handler preventing stack trace or internal database detail leakage.

### 2.6 Security Controls (`src/security/`)
* `src/security/security-headers.ts`: Helmet configuration enforcing strict CSP, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy.
* `src/security/rate-limiter.ts`: Sliding-window rate limiter protecting login, upload, and API endpoints against brute-force attacks.
* `src/security/account-lockout.ts`: State machine locking accounts after consecutive authentication failures.
* `src/security/secrets-manager.ts`: Cryptographic provider managing session keys, HMAC download token keys, and master encryption keys.

### 2.7 Domain Services (`src/services/`)
26 core services managing business logic:
* `audit-service.ts`: Append-only, hash-chained cryptographic audit ledger.
* `backup-service.ts`: Database backup and point-in-time recovery manager.
* `case-service.ts`: Case CRUD and lifecycle operations with multi-tenant filtering.
* `duplicate-detection-service.ts`: Content similarity and URL duplicate matching.
* `entitlement-service.ts`: Plan quota checks and entitlement enforcement.
* `escalation-service.ts`: GAC and senior legal escalation management.
* `evidence-hasher.ts`: Streaming SHA-256 hash generator with chunked validation.
* `evidence-service.ts`: Evidence metadata, custody chain, and WORM management.
* `notification-service.ts`: Internal notifications with dry-run isolation.
* `onboarding-service.ts`: Tenant onboarding, initial role provisioning, and workspace setup.
* `pilot-admin-service.ts`: Controlled-pilot administration and diagnostic inspection.
* `platform-playbook-service.ts`: Statutory playbook directory for 9 global platforms.
* `platform-registry-service.ts`: Registry of platform contacts and grievance mechanisms.
* `readiness-service.ts`: Production readiness probe and safety invariant verification.
* `report-service.ts`: Executive and statutory incident reporting.
* `response-tracking-service.ts`: Platform SLA timers and response status tracking.
* `retention-service.ts`: Statutory retention rules (180 days) and two-person deletion workflow.
* `reupload-monitoring-service.ts`: Post-takedown mirror and re-upload tracking.
* `source-capture.ts`: Controlled capture of public signal metadata.
* `statutory-clock-service.ts`: Rule 3(2) IT Rules 24h acknowledgement and 72h resolution clock.
* `submission-packet-service.ts`: Generates structured evidence dossiers and notice packets.
* `submission-service.ts`: Submission preparation, dry-run simulation, and approval enforcement.
* `tenant-service.ts`: Tenant isolation and organization metadata management.
* `triage-service.ts`: Threat categorization and severity calculation.
* `usage-metering-service.ts`: Granular usage metric recording for billing audits.
* `workflow-task-service.ts`: Internal task queue and assignment engine.

### 2.8 Specialized Service Subpackages
* `src/services/billing/`:
  - `dry-run-billing-provider.ts`: Simulates invoice generation and meter aggregation without live payment gateway coupling.
* `src/services/evaluation/`:
  - `adjudication-service.ts`: Evaluates candidate signals against statutory criteria.
  - `feedback-service.ts`: Captures operator corrections for evaluation refinement.
  - `intelligence-provider.ts`: Local deterministic rule evaluator.
  - `metrics-service.ts`: Precision/recall and operator turnaround metrics.
  - `privacy-review-service.ts`: PII detection and redaction review.
  - `reviewer-quality-service.ts`: Inter-reviewer consistency scoring.
  - `ruleset-version-service.ts`: Version-controlled evaluation rulesets.
  - `suppression-service.ts`: False-positive suppression list management.
* `src/services/integrations/`:
  - `circuit-breaker.ts`: Tripwire circuit breaker suspending outbound calls upon failure.
  - `oauth-service.ts`: Authorization Code + PKCE provider OAuth flow.
  - `provider-adapter-interface.ts`: Standard interface for platform adapters.
  - `provider-sync-service.ts`: Read-only sync of platform grievance updates.
  - `token-encryption.ts`: AES-256-GCM encryption for stored OAuth credentials.
  - `webhook-service.ts`: Inbound WebSub webhook signature verification and ledgering.
  - `youtube-adapter.ts`: Read-only YouTube API adapter with strict scope restrictions.
* `src/services/monitoring/`:
  - `candidate-review-service.ts`: Human-in-the-loop candidate promotion/dismissal.
  - `candidate-scoring-service.ts`: Algorithmic signal risk scoring.
  - `correlation-service.ts`: Cross-platform actor and campaign clustering.
  - `monitoring-policy-service.ts`: Per-tenant signal ingestion policies.
  - `signal-case-link-service.ts`: Links confirmed signals to existing or new cases.
  - `signal-ingestion-service.ts`: Ingestion pipeline for external signals.
  - `subject-service.ts`: Monitored brand and executive profile registry.
  - `url-normalization-service.ts`: Normalizes social media URLs, stripping tracking parameters.
  - `adapters/`: 5 ingestion adapters (`adapter-interface.ts`, `file-replay-adapter.ts`, `local-fixture-adapter.ts`, `manual-signal-adapter.ts`, `webhook-signal-adapter.ts`).

### 2.9 Storage Abstraction Layer (`src/storage/`)
* `src/storage/evidence-storage.ts`: Local staging filesystem storage with SHA-256 validation, path-traversal prevention, and WORM simulation.
* `src/storage/managed-object-storage.ts`: Enterprise interface targeting AWS S3 Object Lock in COMPLIANCE mode with Customer-Managed KMS Key (CMK) encryption.

### 2.10 Background Workers (`src/workers/`)
* `src/workers/worker-manager.ts`: Manages 8 persistent background workers using distributed SQLite lease locks:
  1. `statutory-clock-worker`: Ticks IT Rules 2021 SLA timers and triggers escalation warnings.
  2. `monitoring-ingestion-worker`: Polls and processes pending raw monitoring signals.
  3. `candidate-scoring-worker`: Calculates threat scores on ingested candidates.
  4. `evidence-integrity-worker`: Re-hashes archived evidence objects to detect bit-rot.
  5. `provider-sync-worker`: Polls platform complaint statuses.
  6. `webhook-retry-worker`: Retries failed inbound webhook event processing with exponential backoff.
  7. `retention-worker`: Enforces 180-day WORM expiration and two-person deletion workflows.
  8. `usage-rollup-worker`: Aggregates hourly tenant resource consumption.

### 2.11 API Routes (`src/routes/`)
21 route handlers mounted on `/api/*` and `/health/*`:
* `audit-routes.ts`, `auth-routes.ts`, `billing-routes.ts`, `case-routes.ts`, `entitlement-routes.ts`, `escalation-routes.ts`, `evaluation-routes.ts`, `evidence-routes.ts`, `health-routes.ts`, `integration-routes.ts`, `monitoring-routes.ts`, `notification-routes.ts`, `onboarding-routes.ts`, `pilot-admin-routes.ts`, `platform-routes.ts`, `report-routes.ts`, `reupload-routes.ts`, `submission-routes.ts`, `tenant-routes.ts`, `usage-routes.ts`, `workflow-routes.ts`.

### 2.12 Client Single-Page Application (`src/client/`)
* `src/client/index.html`: Modern responsive UI with semantic HTML, role switcher, dashboard cards, case tables, evidence inspection modals, and emergency status banners.
* `src/client/app.js`: Vanilla JavaScript SPA controller utilizing Tailwind CSS, event handlers, API fetch abstraction, modal lifecycle, and error notifications.

---

## 3. Test Suite Inventory (`tests/`)

The automated test suite contains **80 test files** and **447 passing tests** executed via Vitest v3.0.8:

### 3.1 Unit Tests (`tests/unit/` — 23 files, 115 tests)
* `adjudication.test.ts` (4 tests): Verification of signal adjudication rules.
* `backup-recovery.test.ts` (3 tests): SQLite vacuum and snapshot procedures.
* `billing-dry-run.test.ts` (4 tests): Simulation of SaaS invoices without live billing.
* `candidate-correlation.test.ts` (4 tests): Cross-signal correlation logic.
* `candidate-review.test.ts` (5 tests): Promotion/dismissal workflows.
* `candidate-scoring.test.ts` (5 tests): Algorithmic threat scoring.
* `circuit-breaker.test.ts` (6 tests): Threshold tripping and cooldown states.
* `dry-run-adapter.test.ts` (4 tests): Guarantee of zero live platform mutations.
* `entitlements.test.ts` (5 tests): Subscription quota limits.
* `evaluation-metrics.test.ts` (2 tests): F1-score and precision/recall calculations.
* `local-intelligence-provider.test.ts` (5 tests): Deterministic rule heuristics.
* `notification-outbox.test.ts` (4 tests): Outbox queuing without SMTP transmission.
* `platform-playbooks.test.ts` (4 tests): Playbook step mapping for 9 platforms.
* `platform-registry.test.ts` (3 tests): Contact metadata resolution.
* `readiness-engine.test.ts` (4 tests): Verification of system safety invariants.
* `ruleset-versioning.test.ts` (4 tests): Semantic versioning of evaluation rules.
* `safe-adapters.test.ts` (4 tests): Mock adapter isolation.
* `state-machine.test.ts` (6 tests): Case state transition constraints.
* `statutory-clock.test.ts` (4 tests): 24h/72h IT Rules SLA timers.
* `statutory-source-discipline.test.ts` (2 tests): Legal reference validation.
* `subject-authorization.test.ts` (5 tests): Monitored subject ownership validation.
* `submission-packet.test.ts` (4 tests): Forensic dossier formulation.
* `submission-state-machine.test.ts` (6 tests): Multi-facet approval state transitions.
* `suppression-rules.test.ts` (4 tests): Signal suppression patterns.
* `token-encryption.test.ts` (5 tests): AES-256-GCM encryption round-trips.
* `triage-service.test.ts` (5 tests): Threat severity calculations.
* `url-normalization.test.ts` (7 tests): URL sanitization and parameter stripping.
* `usage-metering.test.ts` (5 tests): Granular event metering.
* `youtube-adapter.test.ts` (8 tests): Read-only YouTube API contract.

### 3.2 Integration Tests (`tests/integration/` — 14 files, 87 tests)
* `audit-trail.test.ts` (5 tests): End-to-end audit ledger verification.
* `evaluation-lifecycle.test.ts` (6 tests): Evaluation from signal to review.
* `evidence-authorization.test.ts` (5 tests): Multi-role evidence access permissions.
* `evidence-lifecycle.test.ts` (7 tests): Upload, hash, lock, and retrieve.
* `integration-routes.test.ts` (6 tests): OAuth and webhook route mounting.
* `monitoring-lifecycle.test.ts` (8 tests): Signal ingestion to candidate creation.
* `onboarding-lifecycle.test.ts` (5 tests): Tenant provisioning and default user creation.
* `phase3-workflow.test.ts` (8 tests): Intake and triage integration.
* `phase4-submission-workflow.test.ts` (9 tests): Submission packet to simulated dispatch.
* `provider-oauth.test.ts` (5 tests): PKCE state verification and callback handling.
* `provider-sync-retention.test.ts` (4 tests): Periodic polling and data retention.
* `provider-webhook.test.ts` (6 tests): Inbound WebSub signature verification.
* `rbac.test.ts` (5 tests): Role permission enforcement across HTTP endpoints.
* `reports-tenant-isolation.test.ts` (4 tests): Report generation scoping.
* `tenant-isolation.test.ts` (4 tests): BOLA and cross-tenant query isolation.
* `worker-lifecycle.test.ts` (5 tests): Background worker leasing and graceful shutdown.

### 3.3 Security & Adversarial Tests (`tests/security/` — 18 files, 112 tests)
* `auth-hardening.test.ts` (5 tests): Token tampering, expiration, and header validation.
* `deletion-two-person.test.ts` (5 tests): Two-person authorization for evidence purging.
* `download-token-security.test.ts` (6 tests): Time-limited HMAC download token security.
* `evidence-safety.test.ts` (5 tests): MIME validation and size limits.
* `evidence-state-machine.test.ts` (6 tests): Immutable state transition guards.
* `foreign-keys-custody.test.ts` (5 tests): Relational integrity of evidence records.
* `independent-verification.test.ts` (11 tests): 11 targeted exploit attacks defeated.
* `input-validation.test.ts` (8 tests): XSS, SQL injection, and path traversal rejection.
* `monitoring-security.test.ts` (6 tests): Signal spoofing and rate limit protection.
* `phase3-security-rbac.test.ts` (6 tests): Intake role enforcement.
* `phase4-approvals-rbac.test.ts` (7 tests): Separation of duty for takedown approvals.
* `phase8-security-audit.test.ts` (8 tests): OAuth credential encryption and key management.
* `pilot-security.test.ts` (4 tests): Pilot safeguards and outbound mutation blocking.
* `preflight-hardening.test.ts` (6 tests): Production preflight environment validation.
* `production-hardening.test.ts` (8 tests): Strict security headers, CORS, and cookie flags.
* `red-team.test.ts` (6 tests): Bounded adversarial exploitation attempts.
* `retention-worker.test.ts` (2 tests): Statutory retention period enforcement.
* `reupload-monitoring.test.ts` (3 tests): URL tracking and metadata monitoring.
* `ssrf-url-validation.test.ts` (9 tests): Cloud metadata (169.254.169.254) and internal IP blocking.
* `streaming-upload-limits.test.ts` (5 tests): Multipart upload payload limits.

### 3.4 Database & Storage Tests (`tests/database/`, `tests/storage/` — 10 files, 57 tests)
* `database/migrations.test.ts` (5 tests): Migration execution and rollback.
* `database/phase3-migrations.test.ts` to `phase8-migrations.test.ts` (6 files, 30 tests): Incremental migration validations.
* `storage/cloud-failure-scenarios.test.ts` (10 tests): KMS unavailability and WORM rejection simulation.
* `storage/evidence-lifecycle-audit.test.ts` (5 tests): Forensic audit event emission.
* `storage/evidence-storage.test.ts` (7 tests): Local storage WORM semantics and path sandboxing.

### 3.5 Resilience & Benchmark Tests (`tests/resilience/`, `tests/benchmark/` — 2 files)
* `resilience/failure-injection.test.ts` (6 tests): SQLite busy timeout and worker crash resilience.
* `benchmark/performance-cost.benchmark.ts`: Synthetic throughput benchmark (12,178 items/sec, tail P99 0.304ms).

---

## 4. Documentation Inventory (`docs/`)

The repository includes 61 comprehensive documentation artifacts:
* **Architecture:** `architecture.md`, `phase3-architecture.md`, `phase4-architecture.md`, `threat-model.md`, `security-model.md`, `security-posture.md`.
* **Engineering & Operations:** `operational-runbooks.md`, `backup-and-recovery.md`, `disaster-recovery-plan.md`, `deployment.md`, `deployment-rollback.md`, `key-rotation-procedure.md`, `worker-operations.md`, `retention-and-deletion.md`, `evidence-handling.md`, `notification-outbox.md`, `billing-dry-run.md`, `usage-and-entitlements.md`, `customer-onboarding.md`.
* **Testing & Quality Assurance:** `testing-strategy.md`, `penetration-testing-checklist.md`, `ADVERSARIAL_REPORT.md`, `OPERATOR_UAT_REPORT.md`, `SECURITY_REVIEW.md`, `CHANGE_AUDIT.md`, `final-localhost-regression.md`, `phase-11-localhost-uat.md`, `phase-11b-localhost-uat.md`, `phase-11c-localhost-uat.md`.
* **Phase Assurance & Release Reports:** `phase-10-assurance-report.md`, `phase-10-ga-decision.md`, `phase-11-baseline.md`, `phase-11-ga-decision.md`, `phase-12-external-assurance.md`, `PHASE12_EXECUTIVE_REPORT.md`, `RELEASE_CANDIDATE_FREEZE.md`.
* **Architecture Decision Records (`docs/decisions/`):**
  - `0001-modular-monolith-tech-stack.md`: Node.js, TypeScript, SQLite WAL architecture.
  - `0002-india-first-legal-and-platform-taxonomy.md`: IT Rules 2021 statutory alignment.
  - `0003-human-in-the-loop-safeguards.md`: Mandatory human review boundary.
  - `0004-evidence-storage-and-chain-of-custody.md`: Streaming SHA-256 and WORM retention.
* **External Assurance Packages (`docs/external-assurance/`):**
  - `EXT-001_SCOPE.md`, `EXT-001_ARCHITECTURE.md`, `EXT-001_RULES_OF_ENGAGEMENT.md`, `EXT-001_TEST_ACCOUNT_MATRIX.md`, `EXT-001_EVIDENCE_CHECKLIST.md`.
  - `CLOUD-001_ASSURANCE.md`.
  - `SOAK-001_CANARY_PLAN.md`.
  - `LEG-001_COUNSEL_PACKAGE.md`.

---

## 5. Machine-Readable Results Inventory (`results/`)

* `PHASE12_BASELINE.json`: Authoritative reconciliation of commit `e7db64c` and test metrics.
* `ASSURANCE_REGISTER.json`: Control plane register tracking `EXT-001`, `CLOUD-001`, `SOAK-001`, `LEG-001`.
* `ASSURANCE_EVIDENCE_INDEX.json`: Evidence catalog mapping 10 key assurance items.
* `EXT-001_FINDINGS.json`: Status of independent penetration testing (`OPEN`).
* `CLOUD-001_EVIDENCE.json`: Status of AWS `ap-south-1` infrastructure (`OPEN`).
* `SOAK-001_EVIDENCE.json`: Status of 72-hour canary soak (`BLOCKED`).
* `LEG-001_EVIDENCE.json`: Status of Indian legal counsel review (`OPEN`).
* `FINAL_GA_GATE.json`: Formal evaluation of all 17 gates (`13 PASS, 4 BLOCKED`).
* Historical evaluation JSONs: `final-localhost-regression.json`, `phase-11b-uat-results.json`, `phase-11c-uat-results.json`, `staging-deployment-results.json`, `MASTER_GRAPH_RESULTS.json`.

---

## 6. Infrastructure & Deployment Assets

* `Dockerfile`: Multi-stage production container build with non-root security context.
* `docker-compose.yml`: Staging deployment stack with volume isolation.
* `docker-compose.prod.yml`: Production container specification.
* `terraform/`:
  - `main.tf`: AWS provider setup pinned to `ap-south-1`.
  - `kms.tf`: Customer-Managed KMS Key (CMK) with annual rotation and deletion denial.
  - `s3_object_lock.tf`: S3 bucket with Object Lock in COMPLIANCE mode and 180-day default retention.
  - `iam.tf`: Least-privilege container execution role explicitly denying `s3:DeleteObject`.
  - `variables.tf`: Strict region constraint enforcing India Data Residency.
  - `outputs.tf`: Exported KMS Key ARNs and S3 Bucket IDs.

---

## 7. Git Provenance & Working Tree State

* **Active Branch:** `main`
* **Commit Hash:** `e7db64ce58111a6a5f1bbf6b49d0b3e6dc6fb2db`
* **Release Tag:** `v1.0.0-controlled-pilot-rc2`
* **Previous Baseline Tag:** `v1.0.0-rc1` (`bfe0885bec0f1dd317935001fe8452bd36d16952`)
* **Remote:** None configured locally.
* **Working Tree:** Pristine (0 tracked modifications).
