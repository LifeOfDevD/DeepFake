# Digital Impersonation Response Desk: System Architecture

## 1. Architectural Style: Modular Monolith
The system is constructed as a high-cohesion, low-coupling **Modular Monolith** in TypeScript. This architecture satisfies the dual requirements of enterprise maintainability, strict transaction boundaries, and rapid operational feedback without the distributed complexity and network failure modes of microservices.

```
+-----------------------------------------------------------------------------------------+
|                                    Frontend Web UI                                      |
|            (React 18/19, TypeScript, Tailwind CSS, Lucide Icons, WCAG 2.1 AA)            |
+-----------------------------------------------------------------------------------------+
                                             | REST / JSON APIs (Session Auth + CSRF)
                                             v
+-----------------------------------------------------------------------------------------+
|                                API Gateway & Router                                     |
|           (Rate Limiting, Tenant Context Resolver, Security Headers, Zod Validator)     |
+-----------------------------------------------------------------------------------------+
       |                  |                  |                  |                  |
       v                  v                  v                  v                  v
+--------------+  +--------------+  +--------------+  +--------------+  +--------------+
|   Identity   |  |     Case     |  |   Evidence   |  |   Policy &   |  |  Notices &   |
|   & Tenancy  |  |  Management  |  |    Locker    |  |Classification|  |   Actions    |
+--------------+  +--------------+  +--------------+  +--------------+  +--------------+
       |                  |                  |                  |                  |
       +------------------+------------------+------------------+------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                           Core Infrastructure & Persistence                             |
|  - SQLite (WAL Mode, Foreign Key Enforcement, Transaction Isolation)                    |
|  - Cryptographic Evidence Store (SHA-256 Hashing, Signed Local URIs)                    |
|  - Append-Only Audit Event Log (Tenant Scoped, Actor Tracked)                           |
|  - Async Worker & Timer Engine (Business Hours / 24x7 Statutory Clocks)                 |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Core Modules & Boundaries

### 2.1 Identity & Tenancy (`identity_and_tenancy`)
- **Tenant Context**: Every database query and business transaction operates under a verified `organization_id`.
- **RBAC**: Enforcement of roles (`system_admin`, `org_owner`, `org_admin`, `case_manager`, `analyst`, `legal_reviewer`, `read_only_stakeholder`).
- **Session Security**: HttpOnly, SameSite cookies or signed bearer tokens with cryptographic salt; account lockout protection.

### 2.2 Case Management (`cases`)
- **Deterministic State Machine**: Strictly validates state transitions. Prevents skipping mandatory phases (e.g. cannot transition to `submitted` without `ready_for_submission` and explicit approval).
- **Incident Metadata**: Category, priority (`low`, `medium`, `high`, `critical`), assignee, target entity, contested URLs.
- **Activity & Comment Stream**: Internal team discussions, client-facing notes, and automatic state-change logs.

### 2.3 Evidence Locker (`evidence`)
- **Storage Abstraction (`EvidenceStorage`)**: Decoupled interface supporting `LocalEvidenceStorage` (production/dev with atomic temp-write and rename) and `InMemoryEvidenceStorage` (instant, zero-filesystem testing).
- **Tenant-Segregated Namespaces**: Files are physically isolated under directory paths `evidence/{organization_id}/{case_id}/{evidence_id}/{filename}` with strict path traversal verification (`path.normalize` and root containment).
- **Cryptographic Integrity (Streaming SHA-256)**: Files are processed via a single-pass streaming hashing pipeline. SHA-256 digests are stored in `evidence_items` and returned as `ETag` headers on download.
- **Magic-Byte Sniffing & Malware Rejection**: Validates true binary signatures (PNG, JPEG, WEBP, MP4, PDF, WebM, audio) and enforces strict rejection of executable formats (`.exe`, `.bat`, `.sh`, `.cmd`, `.msi`, `.elf`). Size limits enforced (50MB images, 500MB video).
- **Time-Limited HMAC-SHA256 Download Tokens**: No public storage URLs. Downloads require authenticated session context or an ephemeral signed token (`/api/evidence/:id/download?token=...`) valid for 300 seconds, binding evidence ID, tenant ID, user ID, and expiry.
- **Legal Hold Locking (`evidence_retention_holds`)**: Immutable hard lock preventing deletion or automated expiration while active.
- **Two-Person Deletion Rule**: Deletion requires an initial request (`deletion_requested`) by an operator and an explicit second approval (`deletion_approved`) by an organization owner, legal counsel, or system admin before physical purging occurs.
- **Chain of Custody Ledger**: Every access, view, download, sensitivity change, hold, and deletion event is recorded in `evidence_access_events` and mirrored to the tenant's immutable `audit_events` log.

### 2.4 Policy & Classification (`policy_and_classification`)
- **Versioned Policy Engine**: Stores statutory bases (IT Act 66C/66D/66E, IT Rules 2021 Rule 3, BNS 2023, Copyright 1957) and platform policies (Meta, Google, X, LinkedIn, Telegram, WHOIS).
- **Authority Validation**: Requires customer authorization letters, trademark registrations, or identity documentation before claims are cleared.
- **Statutory Deadlines**: Automatically calculates India IT Rules 2021 Rule 3(2)(b) 24-hour priority clocks or 72-hour general intermediary clocks based on classification.

### 2.5 Notices & Actions (`notices_and_actions`)
- **Drafting Engine**: Assembles structured grievance petitions, platform takedown notices, and cease-and-desist communications.
- **Human Review Gate**: Every notice is stamped with an explicit `approval_status` (`draft`, `reviewed`, `approved`, `rejected`, `superseded`).
- **External Action Adapter Interface**:
  - `validate(input)`: Validates completeness of complainant authority and evidence.
  - `preview(input)`: Generates rendered notice for human sign-off.
  - `submit(input)`: Dispatches via adapter (default: `DryRunExternalActionAdapter`).
  - `getStatus(externalId)`: Polls/simulates platform response.
  - `cancel(externalId)`: Revokes pending actions.

### 2.6 Monitoring & Signal Ingestion (`monitoring_and_signals`)
- **Provider Abstraction**: Pluggable adapters for URL monitoring, synthetic media detectors, and domain WHOIS monitors.
- **Advisory Status**: Detector outputs produce advisory signals, never automated complaints or public accusations.
- **Deduplication Engine**: Prevents identical URL or image re-scans from spawning duplicate cases; merges signals into active incidents.

### 2.7 Timers & Escalations (`timers_and_escalations`)
- **Dual Clock Engine**: Evaluates statutory clocks (calendar hours under IT Rules 2021) versus business SLA clocks (operational working hours).
- **Escalation Hierarchy**: L1 (Analyst) -> L2 (Case Manager) -> L3 (Legal Reviewer / Resident Grievance Officer) -> L4 (Grievance Appellate Committee / Law Enforcement NCRP).

### 2.8 Reporting & Audit (`reporting_and_audit`)
- **Append-Only Audit Log**: Records every state change, document access, role grant, and submission event.
- **Incident Dossier**: Generates court-ready and client-ready PDF/Markdown incident summaries with full cryptographic hash manifests and chain of custody.

---

## 3. Technology Stack Decisions & Rationale

| Layer | Selected Technology | Architecture Rationale |
| :--- | :--- | :--- |
| **Runtime** | Node.js v22 (LTS) | Native ESM, built-in crypto, fast startup, ubiquitous Windows/Linux support. |
| **Language** | TypeScript 5+ (Strict) | Compile-time safety for critical legal state machines and tenant boundaries. |
| **Server Framework** | Express / Fastify + Zod | Battle-tested, zero magic, rigorous request/response contract validation. |
| **Database** | SQLite via `better-sqlite3` | Zero-setup, instant test execution, ACID transactions, WAL mode for concurrency, portable. Easily swappable to PostgreSQL. |
| **Frontend** | React 18/19 + Vite | Fast HMR, clean component tree, zero bundle bloat. |
| **Styling** | Tailwind CSS | Predictable design tokens, accessible contrast, calm operational UI palette. |
| **Testing** | Vitest + Supertest | Blazing-fast execution, unified TypeScript runner for unit, integration, and security tests. |

---

## 4. Multi-Tenant Data Isolation Strategy
1. **Schema-Level Isolation**: Every persistent entity includes an `organization_id` foreign key.
2. **Repository Layer Enforcement**: Every database query must require `organization_id` in the `WHERE` clause:
   ```sql
   SELECT * FROM cases WHERE id = ? AND organization_id = ?;
   ```
3. **Service Layer Isolation**: The authenticated tenant context is passed explicitly from the HTTP middleware down through domain services. Cross-tenant access throws an explicit `TenantIsolationError` and generates a critical security audit event.
