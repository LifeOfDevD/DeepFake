# Phase 2 Security Posture & Architecture Hardening

## 1. Executive Summary

This document details the multi-layered security hardening implemented across **Phase 2: Evidence Locker and Chain of Custody** of the **Digital Impersonation Response Desk**. 

Phase 2 is specifically engineered for **controlled pilot operations** handling sensitive, synthetically generated, and operator-submitted digital evidence without risk of data tampering, accidental evidence destruction, server-side request forgery (SSRF), memory exhaustion, or unauthenticated access.

---

## 2. Hardened Security Domains

```mermaid
graph TD
    Client[Client Request] --> Auth[Auth & Tenant Middleware]
    Auth --> |Prod: Signed Bearer Token Required| Router[Express API Router]
    Auth --> |Prod: Header Auth Rejected 401| Rejection[401 HEADER_AUTH_DISALLOWED]
    
    Router --> Upload[Upload Stream Handler]
    Router --> Evidence[Evidence Service]
    Router --> URLVerify[SSRF Pre-Flight Analyzer]
    
    Upload --> |Chunked Disk Temp Stream| Hasher[Evidence Hasher & Magic Sniffer]
    Hasher --> |PE / ELF / Scripts Rejected| Disallow[400 EXECUTABLE_REJECTED]
    Hasher --> |Passed| Storage[Opaque Storage Locker]
    
    URLVerify --> |Private/Metadata/Obfuscated IPs Blocked| SSRFBlock[400 SSRF_DETECTED]
    
    Evidence --> State[Evidence State Machine]
    Evidence --> DualDelete[Two-Person Deletion Ledger]
    Evidence --> Retention[Automated Retention Sweeper]
    
    DualDelete --> |Approver == Requester Blocked| TwoPersonDeny[403 EVIDENCE_ACCESS_DENIED]
    DualDelete --> |Legal Hold Active Blocked| HoldDeny[409 LEGAL_HOLD_ACTIVE]
    
    State --> DB[(SQLite Engine - Foreign Keys RESTRICT)]
```

---

### Area 1: Configuration Validation & Fail-Closed Secrets (`src/config/env.ts`)
- **Fail-Closed Runtime**: Centralized Zod schema validation runs immediately on boot before database connections or HTTP servers start.
- **Production Secret Entropy**: When `NODE_ENV === 'production'`, `SESSION_SECRET` and `DOWNLOAD_TOKEN_SECRET` must be explicitly provided and be at least 32 characters long.
- **Default Secret Prohibition**: In production mode, any configuration containing `dev_` prefixes or substring `default` immediately raises a fatal process exception (`FatalConfigError`) and halts execution.

### Area 2: Database Integrity & Immutable Custody Forensics (`0003_evidence_hardening.sql`)
- **Foreign Key Restraints**: All evidence-related relational tables (`evidence_items`, `evidence_access_events`, `evidence_retention_holds`, `evidence_deletion_requests`) enforce `ON DELETE RESTRICT` foreign keys pointing to `organizations(id)`, `cases(id)`, and `evidence_items(id)`.
- **Accidental Cascading Prevention**: Dropping an organization or case while evidence records or custody events exist is strictly prohibited by SQLite engine invariants (`PRAGMA foreign_keys = ON`).
- **Chain of Custody Immutability**: `evidence_access_events` records every access, download, status change, and failed unauthorized attempt with actor metadata and timestamps.

### Area 3: Domain State Machine & Terminal State Invariants (`src/domain/evidence-state-machine.ts`)
- **Formal State Transitions**: Permitted transitions are explicitly defined and validated before database persistence:
  - `pending` $\rightarrow$ `available`, `rejected`
  - `available` $\rightarrow$ `quarantined`, `deletion_requested`, `retention_expired`
  - `quarantined` $\rightarrow$ `available`, `deletion_requested`
  - `deletion_requested` $\rightarrow$ `available`, `quarantined`, `deleted`
- **Terminal States**: `deleted`, `retention_expired`, and `rejected` are terminal. Any attempt to transition out of a terminal state throws `InvalidEvidenceStateTransitionError` (HTTP 422).
- **Direct Jump Prevention**: Unilateral jumps (e.g. `pending` $\rightarrow$ `deleted` or `available` $\rightarrow$ `deleted` without an approved deletion request) are blocked.

### Area 4: Authentication Hardening & Session Security (`src/middleware/auth.ts`, `src/middleware/tenant.ts`)
- **HMAC-SHA256 Signed Bearer Tokens**: Session tokens use tamper-evident HMAC-SHA256 signatures (`desk_tok_<b64url_payload>.<b64url_signature>`) with cryptographically secure timing-safe equality checks (`crypto.timingSafeEqual`).
- **Production Header-Auth Elimination**: The `x-user-id` and `x-user-email` headers used for rapid developer iteration and automated testing are strictly disallowed in `NODE_ENV === 'production'`. Requests attempting to supply header credentials return `401 HEADER_AUTH_DISALLOWED`.
- **Cross-Tenant Audit Trail**: Any cross-tenant access attempted by `system_admin` actors is audited to `audit_events` with action `system_admin_cross_tenant_access`.

### Area 5: Storage Isolation & Streaming Upload Defenses (`src/storage/evidence-storage.ts`, `src/services/evidence-hasher.ts`)
- **Bounded Memory Usage**: Uploads are streamed via disk-backed temporary storage (`storage/temp`) rather than buffering into Node.js heap memory.
- **Magic Byte Sniffing**: The initial 512 bytes are inspected for authentic file headers:
  - Validated types: PNG, JPEG, GIF, WebP, PDF, WAV, MP4, WebM, MP3, plain text.
  - Executable headers (Windows PE `MZ`, Linux ELF, Mach-O, scripts with shebang `#!`) are immediately rejected with `400 EXECUTABLE_REJECTED`.
- **MIME Type Mismatch Guard**: Declared `Content-Type` headers are verified against detected media families to block file extension spoofing.
- **Size Ceilings**: Strict category limits (50 MB images/text, 100 MB audio, 500 MB video/PDF) prevent disk exhaustion.
- **Opaque Storage Keys**: Storage keys follow an opaque structure: `evidence/${organizationId}/${caseId}/${evidenceId}/payload${extension}`. User-provided filenames are completely segregated into sanitized display strings and never form part of filesystem paths.
- **Guaranteed Cleanup**: Temp files in `storage/temp` are unlinked in `finally` blocks on both success and error paths.

### Area 6: Two-Person Deletion Approval Workflow (`src/services/evidence-service.ts`)
- **Dual Authorization Principle**: No single operator can delete evidence unilaterally.
- **Workflow Steps**:
  1. Operator A submits a deletion request via `POST /api/evidence/:id/deletion-request`. Evidence transitions to `deletion_requested`.
  2. Operator B approves deletion via `POST /api/evidence/:id/approve-deletion`.
- **Enforcement Rules**:
  - If `approver.user_id === requester.user_id`, approval is denied with `403 EVIDENCE_ACCESS_DENIED` ("Two-person authorization violation: Deletion cannot be approved by the user who submitted the request").
  - If `legal_hold > 0`, deletion is blocked with `409 LEGAL_HOLD_ACTIVE`.
- **Tombstone Immutability**: When deletion succeeds, physical files are securely unlinked and metadata rows are marked `deleted` with `deleted_at` and `deletion_reason`.

### Area 7: Retention Lifecycle & Automated Worker (`src/services/retention-service.ts`)
- **Automated Sweeper**: Periodically sweeps evidence items where `retention_until < NOW()`.
- **Legal Hold Override**: Items with active legal holds (`legal_hold = 1`) are skipped and logged.
- **Forensic Retention**: Expired items have their physical binaries purged from disk while database tombstones (`status = 'retention_expired'`) are preserved for forensic reporting.

### Area 8: Cryptographic Chain of Custody & Download Tokens (`src/services/evidence-service.ts`)
- **SHA-256 Hashing**: Calculated via streaming digest at upload time and stored immutably.
- **Time-Limited Download Tokens**: Direct payload downloads can be mediated through HMAC-signed single-use download tokens valid for maximum 300 seconds (5 minutes).
- **Binding Verifications**: Tokens are cryptographically bound to specific `evidenceId` and `organizationId`. A token generated for Evidence A cannot be used to download Evidence B.
- **Tombstone Protection**: Attempting to download or generate tokens for deleted items returns `410 EVIDENCE_DELETED`.

### Area 9: SSRF Defense & URL Pre-Flight Validation (`src/services/source-capture.ts`)
- **Zero Network Resolution**: Validation is performed purely through cryptographic string and CIDR math without triggering DNS lookups or socket connections.
- **Blocked IP Ranges & Patterns**:
  - Loopback (`127.0.0.0/8`, `::1`, `localhost`)
  - RFC 1918 Private Ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Carrier-Grade NAT (`100.64.0.0/10`)
  - Link-Local & Cloud Metadata (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`)
  - Obfuscated IP Formats (Hexadecimal `0x7f000001`, Octal `0177.0.0.1`, Decimal `2130706433`)
  - Embedded Userinfo Credentials (`https://admin:pass@host/`)
  - Disallowed TLDs (`.internal`, `.local`, `.onion`, `.corp`, `.lan`, `.home`)
  - Synthetic test domains under RFC 2606 (`.example`) are safely permitted.

### Area 10: Hermetic Pilot Boundaries
- **No Live External Takedowns**: Submission adapters remain simulations. Zero live platform takedown requests or external platform API mutations occur.
- **No Automated URL Fetching**: Source URLs are recorded as forensic metadata without issuing live HTTP GET/POST requests across the external web.
- **Hermetic Scanner Stub**: File scanning is abstracted behind `EvidenceScanner` interface (`DefaultInternalScanner`) without calling external third-party cloud antivirus engines.

---

## 3. Threat Matrix & Defense Verification

| Threat Vector | Severity | Mitigation Architecture | Verification Test Suite |
| :--- | :--- | :--- | :--- |
| Unilateral Evidence Tampering / Deletion | Critical | Two-person deletion approval; immutable audit ledger; `ON DELETE RESTRICT` constraints | `tests/security/deletion-two-person.test.ts`, `tests/security/foreign-keys-custody.test.ts` |
| Malicious Executable Upload / Web Shell | High | Magic byte sniffing; extension prohibition; opaque storage paths outside public root | `tests/security/streaming-upload-limits.test.ts` |
| Server-Side Request Forgery (SSRF) | High | Static CIDR math parsing; zero DNS querying; cloud metadata & octal/hex IP blocking | `tests/security/ssrf-url-validation.test.ts` |
| Memory Exhaustion via Large Files | High | Disk-backed streaming uploads; 500MB chunk ceiling; explicit temp file cleanup | `tests/security/streaming-upload-limits.test.ts` |
| Token Spoofing / Header Auth in Prod | Critical | HMAC-SHA256 signature verification; fail-closed rejection of `x-user-id` in production | `tests/security/auth-hardening.test.ts`, `tests/security/download-token-security.test.ts` |
| Accidental Evidence Destruction under Legal Review | Critical | `legal_hold` flags blocking deletion sweeps; dual authorization override | `tests/security/retention-worker.test.ts`, `tests/integration/evidence-lifecycle.test.ts` |
