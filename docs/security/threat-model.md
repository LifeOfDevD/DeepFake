# Threat Model: 19 Attack Vectors & Defense Architecture

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  

---

## 1. Overview & Threat Landscape

The Digital Impersonation Response Desk operates in an adversarial environment. Threat actors range from sophisticated impersonation syndicates attempting to tamper with evidence dossiers, to aggrieved parties probing for cross-tenant data leaks, to malicious automated crawlers attempting DoS.

This document details the 19 primary threat vectors modeled during architectural design, their implemented mitigations, and their automated verification mechanisms.

---

## 2. Threat Analysis Matrix (19 Vectors)

| ID | STRIDE Category | Asset / Surface | Threat Scenario | Implemented Mitigation | Verification Test |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T-01** | Denial of Service | Public HTTP Surface | Direct HTTP flood or brute-force probing of authentication endpoints | Sliding-window memory rate limiter (`rate-limiter.ts`), production Helmet CSP & HSTS | `tests/security/production-hardening.test.ts` |
| **T-02** | Elevation of Privilege | Case / Evidence Data | Malicious user in Org A attempts IDOR / BOLA against Org B cases | Tenant isolation middleware (`tenant.ts`), parameterized `WHERE organization_id = ?` queries returning 404 | `tests/integration/tenant-isolation.test.ts` |
| **T-03** | Spoofing | User Identity | Compromised credentials via credential stuffing or phishing | Account lockout after consecutive failed attempts (`account-lockout.ts`), rate-limited login | `tests/security/production-hardening.test.ts` |
| **T-04** | Elevation of Privilege | Administrative Actions | Rogue admin attempts unilateral deletion of evidence or cases | Two-person deletion workflows (`retention-service.ts`), tamper-evident append-only audit log | `tests/security/deletion-two-person.test.ts` |
| **T-05** | Information Disclosure | Platform Credentials | Stolen OAuth client secrets via config dump or logs | Secrets manager integration (`secrets-manager.ts`), read-only scopes (`youtube.readonly`), zero secrets in logs | `tests/security/phase8-security-audit.test.ts` |
| **T-06** | Information Disclosure | Provider OAuth Tokens | Database dump exposes stored YouTube access/refresh tokens | AES-256-GCM encryption at rest (`token-encryption.ts`), tokens omitted from all API responses | `tests/unit/token-encryption.test.ts` |
| **T-07** | Tampering | Evidence Storage | Malicious executable or oversized web shell uploaded as evidence | Magic-byte MIME detection, 50MB stream bounds, opaque UUID storage keys outside web root | `tests/storage/evidence-lifecycle-audit.test.ts` |
| **T-08** | Tampering | WebSub Webhook | Forged YouTube Atom feed payload injected to forge signals | HMAC signature verification using constant-time comparison (`crypto.timingSafeEqual`), emergency kill switch | `tests/integration/provider-webhook.test.ts` |
| **T-09** | Repudiation | WebSub Webhook | Intercepted webhook replayed to trigger duplicate ingestion | Idempotency keys generated from signal URL and timestamp, unique constraints on `monitoring_signals` | `tests/integration/provider-webhook.test.ts` |
| **T-10** | Tampering | Tenant Data Boundary | Malicious SQL fragment or URL parameter injected to bypass tenant isolation | Parameterized prepared statements (`better-sqlite3`), strict Zod schema validation on all inputs | `tests/security/independent-verification.test.ts` |
| **T-11** | Information Disclosure | SQLite Database | Unauthorized OS process accesses raw `.sqlite` file on disk | OS file permissions (0600), isolated container volume mounts, non-root execution context | `tests/database/migrations.test.ts` |
| **T-12** | Information Disclosure | Cloud Object Storage | Misconfigured cloud bucket exposes stored evidence publicly | `ManagedObjectStorage` abstraction enforcing private ACLs, S3 Object Lock COMPLIANCE, SSE-KMS CMK | `tests/storage/cloud-failure-scenarios.test.ts` |
| **T-13** | Information Disclosure | Operational Logs | Logs inadvertently output passwords, session tokens, or PII | Structured JSON logger with automated regex redaction of authorization, secret, cookie, and token keys | `tests/security/production-hardening.test.ts` |
| **T-14** | Denial of Service | Background Workers | Malicious task payload causes infinite loop or memory exhaustion | Worker leasing with timeout bounds, max 5 retries with dead-letter queuing, graceful shutdown handlers | `tests/resilience/failure-injection.test.ts` |
| **T-15** | Tampering | Software Supply Chain | Malicious dependency introduced via upstream npm package | Lockfile integrity verification (`package-lock.json`), zero unnecessary native dependencies | `tests/security/preflight-hardening.test.ts` |
| **T-16** | Denial of Service | Event Loop | Oversized JSON/multipart body overwhelms Node.js event loop | Body parser payload ceilings (1MB API, 50MB streaming evidence), SQLite busy timeout (5000ms) | `tests/security/streaming-upload-limits.test.ts` |
| **T-17** | Accidental Mutation | Operator Interface | Operator accidentally triggers real takedown notice against live platform | Strict invariant `ENABLE_LIVE_PLATFORM_ACTIONS = false`, notices generated in `draft` mode only | `tests/security/pilot-security.test.ts` |
| **T-18** | Tampering | Backup Archive | Backup archive modified or injected with corrupt schemas | SHA-256 database and file checksums committed to `backup-manifest.json`; validated prior to restore | `tests/unit/backup-recovery.test.ts` |
| **T-19** | Tampering | Disaster Recovery | Operator accidentally restores backup directly over active DB | `restoreToIsolatedTarget` hardcoded safety check rejecting any restore where target matches runtime DB | `tests/unit/backup-recovery.test.ts` |

---

## 3. Residual Risks & External Assurance Dependencies

While internal code mitigations are verified across all 19 vectors, the following residual risks cannot be closed internally and define our four open external assurance blockers:
* **Residual Risk 1 (Zero-Day Exploitation):** Internal tests cannot substitute for external adversarial probing. *Blocked on `EXT-001` (Third-Party Penetration Testing).*
* **Residual Risk 2 (Hardware-Level Storage Compliance):** Local filesystem WORM simulation cannot provide immutable WORM hardware guarantees. *Blocked on `CLOUD-001` (AWS S3 Object Lock in `ap-south-1`).*
* **Residual Risk 3 (V8 Long-Term Heap Fragmentation):** Unit/integration tests cannot prove heap stability over days of continuous traffic. *Blocked on `SOAK-001` (72-Hour Canary Soak).*
* **Residual Risk 4 (Statutory Interpretation Conflict):** IT Rules 180-day retention vs DPDP Section 12(3) Right to Erasure requires formal legal standing. *Blocked on `LEG-001` (Indian Legal Counsel Opinion).*
