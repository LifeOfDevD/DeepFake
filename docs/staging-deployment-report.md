# Private Staging / Controlled-Pilot Deployment Report

**Document Version:** 1.0.0  
**Target Environment:** Private Staging / Controlled-Pilot Runtime  
**Local Binding:** `http://127.0.0.1:4001`  
**Private Mesh Binding (Zero-Trust):** `http://100.100.25.15:4001` (WireGuard / Tailscale)  
**Evaluated Release Candidate:** `v1.0.0-rc1` (Frozen Baseline)  
**Source Commit:** `bfe0885bec0f1dd317935001fe8452bd36d16952`  
**Deployment Date:** September 15, 2026  
**Final Staging Verdict:** **`READY`**  
**General Availability (GA) Status:** **`STRICTLY WITHHELD`**  
**Permitted Operating Posture:** **Controlled Pilot / Production-Canary Operation Only**  
**Mandatory Customer-Facing Notice:**  
> *"Controlled pilot / production-canary readiness, subject to independent security, privacy, legal, infrastructure, provider-terms, and operational verification."*

---

## A. Deployment Architecture

The deployed staging environment implements an isolated **Single-Process Modular Monolith with Zero-Trust Network Gating**:

```text
                       AUTHORIZED OPERATOR
                                │
               [WireGuard Encrypted Tailnet / Localhost]
                                │
                                ▼
               ┌──────────────────────────────────┐
               │    Node.js v22.23.2 Runtime      │
               │    (NODE_ENV=staging, Port 4001) │
               ├──────────────────────────────────┤
               │   • Static UI Dashboard (SPA)    │
               │   • Express REST API Endpoints   │
               │   • Helmet / CSP / CORS Defense  │
               │   • 8 In-Process Background      │
               │     Workers (WorkerManager)      │
               └───────────────┬──────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│   Isolated Staging    │             │   Isolated Staging    │
│    SQLite Database    │             │    Evidence Storage   │
│   (WAL Mode, PRAGMA   │             │   • SHA-256 Custody   │
│    foreign_keys=ON)   │             │   • WORM Immutability │
│  ./data/response_     │             │   • Local Encrypted   │
│  desk_staging.sqlite  │             │  ./storage/staging_*  │
└───────────────────────┘             └───────────────────────┘
```

### Deployed Component Breakdown
1. **Frontend Layer:** Embedded single-page application served via Express static middleware from `src/client/` (`index.html` and `app.js`). Direct API connectivity via relative routes (`/api/*`).
2. **Backend API Runtime:** Express 4.21.2 compiled to ES Modules in `dist/src/server.js`, listening on `0.0.0.0:4001`.
3. **Database Engine:** Isolated SQLite 3 instance (`./data/response_desk_staging.sqlite`) running in Write-Ahead Logging (`wal`) mode with foreign key enforcement and 9 applied schema migrations.
4. **Evidence Locker:** Segregated directory hierarchy (`./storage/staging_evidence`, `./storage/staging_temp`, `./storage/staging_backups`) with streaming SHA-256 custody calculation, path-traversal sanitization, and 300-second HMAC download tokens.
5. **Background Workers:** 8 continuous operational workers managed by `WorkerManager` executing on timers:
   * `retention_worker` (60s)
   * `statutory_clock_worker` (60s)
   * `notification_worker` (10s)
   * `usage_aggregation_worker` (60s)
   * `backup_verification_worker` (1h)
   * `monitoring_ingestion_worker` (60s)
   * `candidate_evaluation_worker` (30s)
   * `provider_sync_worker` (60s)
6. **Network Gating:** Private Zero-Trust mesh binding to Tailscale IP `100.100.25.15` and localhost loopback `127.0.0.1`. Non-indexed (`X-Robots-Tag: noindex, nofollow`), non-publicly discoverable.

---

## B. Environment Configuration Inventory

All variables are loaded via `.env.staging`. **In accordance with security policy, secret values are never printed or committed:**

| Configuration Key | Classification | Evaluated Staging Setting | Description & Purpose |
|---|---|---|---|
| `NODE_ENV` | PUBLIC | `staging` | Runtime mode enforcing production-grade secret validation |
| `PORT` | PUBLIC | `4001` | Staging listener port (isolated from dev port 4000) |
| `HOST` | PUBLIC | `0.0.0.0` | Bound to all interfaces including private VPN |
| `APP_URL` | PUBLIC | `http://127.0.0.1:4001` | Canonical base URL for staging invitations |
| `CORS_ALLOWED_ORIGINS` | PUBLIC | `http://127.0.0.1:4001,http://localhost:4001,http://100.100.25.15:4001` | Strict browser cross-origin policy |
| `DATABASE_PATH` | PUBLIC | `./data/response_desk_staging.sqlite` | Isolated staging database path |
| `DATABASE_WAL_MODE` | PUBLIC | `true` | SQLite WAL journal mode |
| `STORAGE_BACKEND` | PUBLIC | `local` | Local disk evidence storage with WORM abstraction |
| `EVIDENCE_STORAGE_DIR` | PUBLIC | `./storage/staging_evidence` | Staging quarantined evidence files |
| `EVIDENCE_TEMP_DIR` | PUBLIC | `./storage/staging_temp` | Staging multipart upload temporary stream buffer |
| `BACKUP_STORAGE_DIR` | PUBLIC | `./storage/staging_backups` | Staging backup archive destination |
| `MAX_UPLOAD_SIZE_MB` | PUBLIC | `50` | Maximum file upload ceiling |
| `SESSION_SECRET` | STAGING_SECRET | *[CONFIGURED — 64-char Hex]* | HMAC signing key for user authentication tokens |
| `DOWNLOAD_TOKEN_SECRET` | STAGING_SECRET | *[CONFIGURED — 64-char Hex]* | HMAC signing key for evidence download tokens |
| `TOKEN_SIGNING_KEY` | STAGING_SECRET | *[CONFIGURED — 64-char Hex]* | HMAC packet signing key |
| `ENCRYPTION_MASTER_KEY`| STAGING_SECRET | *[CONFIGURED — 64-char Hex]* | AES-256-GCM encryption key |
| `PILOT_MODE` | PUBLIC | `true` | Enforces controlled pilot safety guarantees |
| `ENABLE_LIVE_PLATFORM_ACTIONS` | PUBLIC | `false` | Mandatory safety gate (fail-closed) |
| `ENABLE_LIVE_BILLING` | PUBLIC | `false` | Mandatory safety gate (fail-closed) |
| `ENABLE_LIVE_NOTIFICATIONS` | PUBLIC | `false` | Mandatory safety gate (fail-closed) |
| `NOTIFICATION_MODE` | PUBLIC | `in_app` | Restricts alerts to in-app transactional feed |
| `BILLING_MODE` | PUBLIC | `dry_run` | Restricts billing to metered usage simulation |
| `RATE_LIMIT_ENABLED` | PUBLIC | `true` | DoS protection enabled |

---

## C. Deployment Provenance

* **Release Candidate Tag:** `v1.0.0-rc1`
* **Source Commit:** `bfe0885bec0f1dd317935001fe8452bd36d16952`
* **Commit Subject:** `chore(release): frozen release candidate v1.0.0-rc1 baseline`
* **Deployment ID:** `dep_stg_20260915_1706`
* **Deployment Timestamp:** `2026-09-15T17:06:44Z`
* **Runtime Platform:** Node.js v22.23.2 on Windows x64 (10.0.26100)
* **Package Lockfile Digest:** Verified consistent with `package-lock.json`
* **Schema Migrations Applied:** 9 / 9 (`0001_initial_schema.sql` through `0009_phase8_controlled_integrations.sql`)
* **Working Tree State:** Clean, immutable; 0 uncommitted application code changes.

---

## D. Technical Smoke Report (N7)

All 12 technical smoke tests passed without a single failure:

| Test ID | Area | Check Name | Evaluated Criterion | Result |
|---|---|---|---|---|
| `STG-001` | Infrastructure | Staging Server Health Probe | `GET /health` returned HTTP 200 OK, `mode="safely_operable_production_candidate"` | **PASS** |
| `STG-002` | Infrastructure | Readiness Probe | `GET /healthz/ready` returned HTTP 200 OK, status `"ready"` | **PASS** |
| `STG-003` | Infrastructure | Prometheus Metrics | `GET /metrics` returned HTTP 200 with process telemetry | **PASS** |
| `STG-004` | Infrastructure | SQLite PRAGMAs | `integrity_check = ok`, 0 FK violations, `journal_mode = wal` | **PASS** |
| `STG-005` | Infrastructure | Background Workers | 8 workers registered active in `worker_heartbeats` table | **PASS** |
| `STG-006` | Infrastructure | Zero-Trust Mesh Reachability | `GET http://100.100.25.15:4001/health` returned HTTP 200 OK via Tailscale | **PASS** |
| `STG-007` | Authentication | Valid Operator Login | `POST /api/auth/login` authenticated Priya Nair, returned Bearer token | **PASS** |
| `STG-008` | Authentication | Invalid Credentials Defense | `POST /api/auth/login` with bad password rejected with HTTP 401 | **PASS** |
| `STG-009` | Authentication | Unauthorized Route Protection | `GET /api/cases` without Bearer token rejected with HTTP 401 | **PASS** |
| `STG-010` | Application | Web UI Dashboard Delivery | HTML dashboard and `app.js` bundle (>200 KB) delivered successfully | **PASS** |
| `STG-011` | Safety Boundary | Ban on Live Platform Actions | Database confirmed 0 live submissions; `ENABLE_LIVE_PLATFORM_ACTIONS=false` | **PASS** |
| `STG-012` | Safety Boundary | Emergency Kill-Switch Check | `GET /api/integrations/kill-switch` verified administrative cut-off functional | **PASS** |

---

## E. Operator UAT Report (N8: 17-Step Golden Path)

The complete end-to-end incident response lifecycle was executed by an authorized operator using synthetic data:

| Step | Action | Operator Expected Outcome | Actual System Behavior | Status |
|---|---|---|---|---|
| **1** | Operator Login | Login as Incident Response Lead Priya Nair | Authenticated; returned user profile and tenant memberships | **PASS** |
| **2** | Org & Readiness Inspection | Review organization context & readiness checklist | Apex Healthcare Technologies active; onboarding checklist items verified | **PASS** |
| **3** | Create Incident Case | File synthetic impersonation incident case | Created Case `CASE-2026-0006` with status `new` | **PASS** |
| **4** | Triage Incident Case | Transition case from `new` to `evidence_collection` | State machine transitioned `new` $\rightarrow$ `triage` $\rightarrow$ `awaiting_authority` $\rightarrow$ `evidence_collection` | **PASS** |
| **5** | Attach Forensic Evidence | Upload synthetic audio clip reference | Forensic evidence item created with quarantined storage key | **PASS** |
| **6** | Verify SHA-256 Hash | Verify cryptographic evidence integrity | Streaming SHA-256 hash verified (64 hex characters) | **PASS** |
| **7** | Apply Statutory Legal Hold | Enforce preservation order under IT Act | Legal hold imposed; evidence deletion blocked with HTTP 409; hold released cleanly | **PASS** |
| **8** | Ingest Detection Signal | Ingest synthetic monitoring detection signal | Monitored subject registered; signal ingested with HTTP 200/201 | **PASS** |
| **9** | Review Detection Queue | Inspect human review queue | Candidate review queue rendered active items requiring human decision | **PASS** |
| **10** | Platform & Playbook Discovery | Discover statutory playbooks | Verified 7 registered platforms and 9 playbooks with explicit IT Rules SLAs | **PASS** |
| **11** | Draft Platform Submission | Prepare grievance packet for Instagram | Draft created with packet hash calculated under IT Rules 2021 Rule 3(1)(b) | **PASS** |
| **12** | Multi-Person Facet Approval | Sign off legal, evidence, route, and simulation facets | Approved by Legal Reviewer, Case Manager, and Org Owner (Two-person rule enforced) | **PASS** |
| **13** | Execute DRY-RUN Simulation | Dispatch simulation only | Dispatched in DRY-RUN mode; simulated reference ID generated; zero external network call | **PASS** |
| **14** | Verify Zero Live Mutations | Confirm zero external live actions | Database audit confirmed `simulated_submitted` status and exactly 0 live submissions | **PASS** |
| **15** | Inspect Audit Ledger | Review chronological security trail | Append-only audit events retrieved chronologically with actor identities and IPs | **PASS** |
| **16** | Review Tenant Usage | Inspect metered usage summary | Usage aggregates retrieved with exact breakdown across meters | **PASS** |
| **17** | Terminate Session | Logout from response desk | Session token revoked; subsequent authenticated calls returned HTTP 401 | **PASS** |

### Usability & Operator Feedback Evaluation
* **Workflow Clarity:** High. The 4-step state machine transition (`new` $\rightarrow$ `triage` $\rightarrow$ `awaiting_authority` $\rightarrow$ `evidence_collection`) provides explicit statutory milestones preventing premature evidentiary claims.
* **Separation of Duties:** Strong. Requiring distinct roles (Legal Reviewer for `legal_sufficiency`, Case Manager for `evidence_sufficiency`, Org Owner for `simulated_submission`) ensures compliance with institutional governance.
* **Confusion / Friction Points Identified:**
  * In pure API/REST testing, the requirement to pass through `awaiting_authority` before reaching `evidence_collection` is strictly enforced by the state machine; operators using the Web UI are guided naturally by the status transition dropdown.
  * Platform keys (`plt_instagram`) and playbook IDs (`pb_synthetic_media`) require exact matches; the UI handles this gracefully via pre-populated selectors.

---

## F. Security Boundary Report

The deployment was audited against all core safety invariants:

| Security Invariant | Guarantee | Evaluated Staging Reality | Status |
|---|---|---|---|
| **No Autonomous Takedown** | All platform notices require affirmative human approval | 0 live takedowns dispatched; human approval mandatory | **VERIFIED** |
| **No Private-Message Access** | Zero interception or reading of private DM channels | Completely excluded from architecture; zero scrapers | **VERIFIED** |
| **No Unauthorized Scraping** | Strictly authenticated provider APIs & manual intake | Zero unauthorized scraping tools; read-only adapters | **VERIFIED** |
| **No Production Credentials** | Staging runtime isolated from production credentials | Staging secrets generated independently; zero prod keys | **VERIFIED** |
| **No Production Data** | Pure synthetic fixtures only | Seeded from `seeds/demo-fixtures.json`; zero real PII | **VERIFIED** |
| **Emergency Kill-Switch** | Administrative cut-off halts all webhook integrations | Kill switch endpoint active; immediately halts activity | **VERIFIED** |
| **Fail-Closed Secrets** | Rejects short or default dev keys in staging | Strict validation in `src/config/env.ts` active | **VERIFIED** |

---

## G. Findings Register

| Finding ID | Domain | Severity | Description | Disposition |
|---|---|---|---|---|
| `OBS-001` | UX / Workflow | **P2** | Direct REST API calls require explicit knowledge of platform IDs (`plt_instagram`) and playbook IDs (`pb_synthetic_media`); web UI simplifies this via structured dropdowns. | **ACCEPTED FOR PILOT** (UI mitigates friction) |
| `OBS-002` | Network / Access | **P3** | Operators accessing the staging desk remotely via the private Zero-Trust mesh (`http://100.100.25.15:4001`) must have Tailscale installed and authenticated on their device. | **DOCUMENTED** (Standard Zero-Trust procedure) |

* **Open P0 Blockers:** **ZERO (0)**
* **Open P1 Blockers:** **ZERO (0)**

---

## H. Regression Report (Against Phase 11 Baseline)

| Verification Dimension | Phase 11 Local Baseline | Phase 12 Staging Verification | Variance |
|---|---|---|---|
| **Automated Test Files** | 80 / 80 Files Passed | 80 / 80 Files Passed | 0 |
| **Automated Vitest Tests** | 447 / 447 Tests Passed (100.0%) | 447 / 447 Tests Passed (100.0%) | 0 |
| **TypeScript Static Check** | 0 Compiler Errors (`tsc --noEmit`) | 0 Compiler Errors (`tsc --noEmit`) | 0 |
| **SQLite Schema Migrations**| 9 / 9 Applied | 9 / 9 Applied | 0 |
| **PRAGMA Integrity Check** | `integrity_check = ok` | `integrity_check = ok` | 0 |
| **PRAGMA Foreign Keys** | 0 Violations | 0 Violations | 0 |
| **Application Code Changes**| 0 (Immutable Frozen Release) | 0 (Immutable Frozen Release) | 0 |

---

## I. GA Dependency Status (The 4 Canonical Blockers)

In strict accordance with Phase 12 governing rules, **staging deployment success does NOT close or alter external GA blockers**:

```text
====================================================================================================
1. EXT-001: Independent External Penetration Testing
   Status:       BLOCKED / NOT_PERFORMED
   Condition:    Engagement of CREST/OSCP-accredited third-party firm pending.

2. CLOUD-001: Production AWS KMS CMK & S3 Object Lock in ap-south-1
   Status:       BLOCKED / PROVISIONING_PENDING
   Condition:    Live enterprise AWS account credentials and terraform apply pending.

3. SOAK-001: 72-Hour Continuous Staged Canary Soak
   Status:       BLOCKED / NOT_EXECUTED
   Condition:    Gated on CLOUD-001 deployment in live staging Kubernetes cluster.

4. LEG-001: Qualified Indian Legal Counsel Written Opinion
   Status:       BLOCKED / OPINION_PENDING
   Condition:    Retention of practicing Indian technology counsel and written opinion pending.
====================================================================================================
```

---

## J. Final Staging Decision Record

```text
====================================================================================================
FINAL STAGING DECISION:
READY

STAGING ACCESS (PRIVATE ZERO-TRUST MESH):
http://100.100.25.15:4001 (Tailscale Private Network)
http://127.0.0.1:4001 (Localhost Loopback)

RELEASE CANDIDATE:
v1.0.0-rc1 (Commit: bfe0885bec0f1dd317935001fe8452bd36d16952)

PERMITTED OPERATING POSTURE:
Controlled Pilot / Production-Canary Operation Only

GENERAL AVAILABILITY (GA):
STRICTLY WITHHELD (Blocked on EXT-001, CLOUD-001, SOAK-001, LEG-001)
====================================================================================================
```
