# Customer Security Readiness & Architecture Whitepaper

**System:** Digital Impersonation Response Desk  
**Document Version:** 1.0.0  
**Target Audience:** Enterprise CISOs, Data Protection Officers, Security Architecture Review Teams  
**Published Date:** 2026-09-13  

---

> [!IMPORTANT]
> ### FORMAL CUSTOMER STATUS DECLARATION
> This system is currently designated as:  
> **"Controlled pilot / production-canary readiness, subject to independent security, privacy, legal, infrastructure, provider-terms, and operational verification."**  
>  
> Passing internal automated test suites, container hardening validations, and architectural implementations demonstrates technical readiness for controlled pilot evaluations. However, it **DOES NOT** constitute formal certification under SOC 2 Type II, ISO/IEC 27001, ISO 27701, PCI-DSS, or official statutory DPDP certification. Prospective enterprise subscribers must conduct their own independent security, legal, and privacy reviews prior to production deployment.

---

## 1. System Architecture Overview

The Digital Impersonation Response Desk is an India-first incident response and evidence management platform designed to help organizations detect, analyze, triage, and remediate online impersonation, executive deepfakes, and synthetic-media scams under the Information Technology Act 2000 and IT (Intermediary Guidelines) Rules 2021.

```mermaid
graph TD
    Client[Enterprise Client / Browser] -->|TLS 1.3 / HTTPS| WAF[Edge WAF / Reverse Proxy]
    WAF -->|HSTS / CSP / Rate Limiting| App[Node.js / Express Application Server]
    
    subgraph CoreApplication [Application Security Boundary]
        App --> Auth[Auth & Session Engine (HMAC / PBKDF2)]
        App --> RBAC[Tenant Scoping & Role Guard (Viewer/Analyst/Admin)]
        App --> Zod[Input Schema Validation (Zod Strict)]
        App --> Audit[Tamper-Evident SHA-256 Audit Logger]
    end

    subgraph DataPlane [Data Persistence & Encryption]
        App -->|WAL Mode / Foreign Keys| DB[(Encrypted Database Engine)]
        App -->|Opaque UUID Keys / Pre-Signed URLs| Storage[(S3-Compatible Object Store with KMS)]
    end

    subgraph IntegrationsPlane [External Read-Only Integrations]
        App -->|Circuit Breaker / Rate Limit| ProviderAdapter[Official Read-Only Provider Client]
        ProviderAdapter -->|HTTPS / Read-Only Scopes| SocialPlatforms[YouTube Data API v3]
    end
```

---

## 2. Standard Enterprise Security Questionnaire (CAIQ / SIG Lite Alignment)

### 2.1 Governance & Architecture

| Question / Requirement | Enterprise Response |
|---|---|
| **What is the primary deployment environment?** | Containerized microservices running on secure Linux hosts (Alpine Linux, non-root `node` user), deployed in India-based cloud regions (e.g. AWS `ap-south-1` Mumbai). |
| **How are tenants logically separated in multi-tenant mode?** | Every database table containing tenant assets (`cases`, `evidence_items`, `submissions`, `playbooks`, `provider_connections`) includes a foreign-keyed `organization_id`. Tenant scoping is derived directly from verified cryptographic session tokens and enforced at the database query layer (`WHERE organization_id = ?`). Direct object reference (BOLA/IDOR) attempts fail closed with HTTP 403/404. |
| **Does the platform take autonomous actions against public platforms?** | **No.** The platform enforces a strict invariant: `human_review_mandatory: 1`. It **never** issues automated public takedowns, automated legal filings, or automated criminal complaints. All platform submissions and escalation notices require affirmative authorization by an assigned human analyst. |

---

### 2.2 Cryptography & Data Protection

| Question / Requirement | Enterprise Response |
|---|---|
| **What encryption is used for data in transit?** | Mandatory TLS 1.3 for all client-to-server and server-to-external-provider communications. HTTP Strict Transport Security (HSTS) enforced with 1-year max-age and preload. |
| **What encryption is used for data at rest?** | - Database: Host-level encrypted volumes (AES-256).<br>- Evidence Objects: S3 server-side encryption with customer-managed or AWS-managed KMS keys (`aws:kms`).<br>- Sensitive API Secrets / OAuth Tokens: Application-level AES-256-GCM encryption with 100,000-iteration PBKDF2 key derivation and zeroized in-memory credentials. |
| **What is the key rotation mechanism?** | The application incorporates automated key rotation via `SecretsManager`. Up to 5 historical decryption keys can be configured concurrently via `ENCRYPTION_FALLBACK_KEYS`, and an atomic batch utility (`reencryptAllProviderTokens`) updates all stored credentials to the latest master key without service downtime. |

---

### 2.3 Access Control & Authentication

| Question / Requirement | Enterprise Response |
|---|---|
| **How are passwords stored?** | Passwords are salted and hashed using bcrypt with industry-standard work factors. |
| **Is brute-force protection implemented?** | Yes. `AccountLockoutService` tracks failed login attempts; 5 consecutive failures trigger an automatic 15-minute account lockout. In addition, an IP-based sliding-window rate limiter restricts authentication attempts to 10 requests per minute. |
| **What roles and permissions are supported?** | Role-Based Access Control (RBAC) supports 4 distinct tiers: `viewer` (read-only case inspection), `analyst` (evidence triage, case workflow management), `admin` (tenant user provisioning, playbook configuration), and `system_admin` (cross-tenant infrastructure and kill-switch control). |

---

### 2.4 Evidence Custody & Retention

| Question / Requirement | Enterprise Response |
|---|---|
| **How is evidence authenticity preserved?** | Every uploaded evidence binary is hashed immediately upon receipt with SHA-256. Magic byte inspection validates actual MIME types against declared extensions. The hash, byte size, uploader identity, and timestamp are stored in an append-only chain of custody log. |
| **What are default data retention periods?** | Case records and evidence binaries default to 180-day retention. Audit events are retained for 365 days in accordance with the Information Technology (Intermediary Guidelines) Rules 2021. |
| **How does legal hold override work?** | Placing a case or evidence item under legal hold sets `legal_hold = 1`. Any automated deletion sweep or manual deletion request is strictly blocked by the evidence state machine until formal release by an authorized legal officer. |
| **How is evidence deleted?** | Manual deletion requires dual-authorization (two-person rule) for irreversible purges. Once confirmed, storage objects are unlinked and cryptographic keys are shredded. |

---

### 2.5 Disaster Recovery & Business Continuity

| Question / Requirement | Enterprise Response |
|---|---|
| **What are the Recovery Point Objective (RPO) and Recovery Time Objective (RTO)?** | - **RPO Target:** 1 hour (achieved via hourly WAL backups and continuous object storage replication).<br>- **RTO Target:** 15 minutes (tested via point-in-time container and SQLite database restore procedures). |
| **How are backups validated?** | Automated background workers (`BackupVerifyWorker`) compute SHA-256 checksums on all generated snapshots and execute isolated test restores into sandbox containers to detect silent database bit-rot or corrupt journals. |

---

## 3. Compliance & Legal Disclaimers

1. **Independent Legal Counsel Review Required:** Prospective customers must review the platform's evidence generation and grievance escalation playbooks with their internal or external Indian legal counsel to ensure alignment with their internal risk policies.
2. **Third-Party Platform Terms:** Integration with social media platforms (such as YouTube Data API v3) utilizes standard read-only scopes. Subscribers are responsible for adhering to the respective third-party platform terms of service and developer policies.
3. **Pilot Evaluation Scope:** Pilot deployments are restricted to synthetic/staging data or controlled canary evaluations under signed non-disclosure and evaluation agreements.
