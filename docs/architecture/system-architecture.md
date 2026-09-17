# System Architecture Specification

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Current Operating Posture:** Controlled Pilot / Production-Canary Only  

---

## 1. Architectural Style & Monolithic Modularity

The Digital Impersonation Response Desk is built as a **modular monolith** in TypeScript and Node.js. 

Rather than prematurely distributing domain logic into microservices—which introduces complex distributed transaction boundaries and network latency across forensic state transitions—the system maintains strict domain separation within a single deployable unit while isolating background processing into managed worker pools.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT / PRESENTATION TIER                         │
│   Vanilla JS SPA • Tailwind CSS • Semantic HTML5 • CDP Browser Automated    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / TLS
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                            API & SECURITY GATEWAY                           │
│   Helmet CSP • CORS • Sliding Rate Limiter • HMAC Auth • Tenant Guard (BOLA) │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                               DOMAIN SERVICES                               │
│  Triage • Platform Playbooks • Forensic Custody • Multi-Facet Approvals     │
│  Statutory Clocks (IT Rules) • Ruleset Adjudication • Usage Metering        │
└──────────────────┬───────────────────┬───────────────────┬──────────────────┘
                   │                   │                   │
┌──────────────────▼───────┐ ┌─────────▼─────────┐ ┌───────▼──────────────────┐
│     PERSISTENCE TIER     │ │   FORENSIC VAULT  │ │  BACKGROUND WORKERS (8)  │
│  better-sqlite3 in WAL   │ │  Streaming SHA256 │ │  Statutory Clock Worker  │
│  36 Relational Tables    │ │  HMAC Token Gate  │ │  Signal Ingestion Worker │
│  Foreign Keys = ON       │ │  WORM Compliance  │ │  Integrity Audit Worker  │
│  Append-Only Audit Log   │ │  Legal Hold Locks │ │  Retention Worker (180d) │
└──────────────────────────┘ └───────────────────┘ └──────────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Presentation Tier (`src/client/`)
* **Technology:** Vanilla ECMAScript 6+, Tailwind CSS JIT compiler, semantic HTML.
* **Responsibilities:**
  - Dynamic role switcher (`CaseManager`, `LegalCounsel`, `EvidenceSpecialist`, `Analyst`, `OrgAdmin`).
  - Real-time incident triage dashboard and statutory countdown visualizers.
  - Multi-tab navigation: Cases, Forensic Evidence Vault, Monitoring Signals, Platform Playbooks, Submissions, and Audit Trails.
  - Client-side validation with zero direct external API coupling.

### 2.2 API & Middleware Layer (`src/middleware/`, `src/routes/`)
* **Security Middleware:**
  - `security-headers.ts`: Enforces strict CSP, blocking unauthorized external script sources.
  - `rate-limiter.ts`: Sliding-window memory rate limiter mitigating credential stuffing and DoS attacks.
  - `auth.ts`: Validates HMAC-SHA256 signed session tokens. Rejects tokens with forged signatures or expired timestamps.
  - `tenant.ts`: Extracts and validates `organization_id`. Injects tenant scoping into request context, guaranteeing tenant isolation.
  - `rbac.ts`: Enforces role-based permissions at the route handler level.
* **Route Registry:** 21 modular route controllers mounted on `/api/*` and `/health/*`.

### 2.3 Domain Services Tier (`src/services/`)
* **Triage & Threat Engine (`triage-service.ts`):** Calculates threat severity using multi-signal scoring and maps statutory categories under the IT Act (e.g. Sec 66D Cheating by personation).
* **Statutory Clock Service (`statutory-clock-service.ts`):** Enforces Rule 3(2) of the IT Rules 2021 (24-hour mandatory acknowledgement and 72-hour resolution SLA for impersonation/grievance takedowns).
* **Forensic Evidence Service (`evidence-service.ts`, `evidence-hasher.ts`):** Computes streaming SHA-256 hashes, validates magic bytes, and generates 300-second time-limited HMAC download tokens.
* **Submission Packet Service (`submission-packet-service.ts`):** Synthesizes legal dossiers, statutory notices, and chain-of-custody certificates (Section 65B Indian Evidence Act / Section 63 BSA).
* **Multi-Facet Approval Service (`submission-service.ts`):** Enforces separation of duty: requires explicit approval from Legal Counsel and Evidence Specialist before notice preparation.

### 2.4 Persistence & Forensic Storage Tier (`src/db/`, `src/storage/`)
* **Database Engine:** SQLite 3 via `better-sqlite3` v11.8.
* **Configuration:** Write-Ahead Logging (`PRAGMA journal_mode = WAL`), synchronous normal, foreign key enforcement (`PRAGMA foreign_keys = ON`), and connection pooling.
* **Schema:** 36 relational tables across 9 deterministic migrations (`src/db/migrations/`).
* **Audit Ledger:** Cryptographically structured append-only transaction ledger recording every actor ID, timestamp, organization ID, and action detail.
* **Forensic Object Storage:**
  - *Local Mode:* Staging filesystem storage with path-traversal sanitization and simulated WORM retention.
  - *Managed Cloud Mode:* AWS S3 Object Lock configured in `COMPLIANCE` mode with Customer-Managed KMS Key (CMK) encryption in `ap-south-1` (`terraform/s3_object_lock.tf`).

### 2.5 Background Worker Subsystem (`src/workers/`)
A pool of **8 persistent background workers** coordinated via database leases:
1. `statutory-clock-worker`: Evaluates SLA clocks and flags impending breaches.
2. `monitoring-ingestion-worker`: Polls external adapter queues and schedules candidate evaluation.
3. `candidate-scoring-worker`: Runs heuristic and algorithmic threat classification.
4. `evidence-integrity-worker`: Periodically verifies SHA-256 hashes of stored evidence objects to detect bit-rot.
5. `provider-sync-worker`: Synchronizes platform grievance status via read-only APIs.
6. `webhook-retry-worker`: Retries failed webhook processing with exponential backoff.
7. `retention-worker`: Scans for evidence exceeding the 180-day WORM retention window and manages two-person deletion queues.
8. `usage-rollup-worker`: Aggregates hourly tenant storage and API usage metrics.

---

## 3. External Integration Classification

The platform maintains strict discipline regarding external service coupling:

| System / Provider | Operating Mode | Classification | Implementation Status |
|---|---|---|---|
| **YouTube Data API** | Read-Only (`youtube.readonly` scope) | **Implemented & Verified** | Live read-only sync; write/upload scopes strictly forbidden |
| **YouTube WebSub** | Inbound Webhooks (HMAC-SHA256 verified) | **Implemented & Verified** | Verified webhook ingestion with secret hashing |
| **Meta / Instagram** | Playbook Notice Generator | **Simulated / Dry-Run** | Structured notice payload generator; zero live dispatch |
| **X (Twitter)** | Playbook Notice Generator | **Simulated / Dry-Run** | Structured notice payload generator; zero live dispatch |
| **Telegram** | Abuse Email / Form Formulator | **Simulated / Dry-Run** | Structured notice payload generator; zero live dispatch |
| **Payment Gateway** | Dry-Run SaaS Billing | **Simulated / Dry-Run** | Simulated invoices and usage rollups; no live credit card processing |
| **SMTP / Notifications** | In-App Outbox Ledger | **Simulated / In-App Only**| Outbox queue records notifications; SMTP dispatch disabled |
| **AWS S3 Object Lock** | Cloud WORM Forensic Storage | **External Dependency** | Terraform IaC complete; live AWS provisioning pending (`CLOUD-001`) |
| **AWS KMS CMK** | Envelope Encryption Key | **External Dependency** | Terraform IaC complete; live AWS provisioning pending (`CLOUD-001`) |
| **Autonomous Takedown** | Direct External API Dispatches | **NOT IMPLEMENTED** | **Strictly Forbidden by Design** (Human review mandatory) |
