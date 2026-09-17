# Security Boundaries & Trust Architecture

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  

---

## 1. Security Architecture & Trust Zones

The system segments data and execution contexts into discrete trust zones separated by strict cryptographic and authorization barriers:

```mermaid
graph TD
    subgraph Zone 0: Public & Untrusted
        PublicWeb["Public Web / Social Platforms / Attackers"]
        UntrustedSignals["Inbound Webhooks / Crawled URLs"]
    end

    subgraph Zone 1: Edge & Network Boundary
        WAF["Reverse Proxy / ALB (TLS 1.3 Termination)"]
        RateLimit["Rate Limiting & Account Lockout"]
        SecurityHeaders["Helmet CSP / Strict Headers"]
    end

    subgraph Zone 2: Application Context (Isolated by Tenant)
        AuthBarrier["HMAC Session Validator & RBAC Guard"]
        TenantScoping["Tenant Isolation Filter (org_id Scope)"]
        Services["Domain Services (Triage / Playbooks)"]
    end

    subgraph Zone 3: Forensic Storage Boundary
        WORMStorage["Forensic Vault (WORM COMPLIANCE Mode)"]
        HMACGate["300-Second Time-Limited HMAC Tokens"]
        KMSKeys["AWS KMS Customer-Managed Key (ap-south-1)"]
    end

    subgraph Zone 4: Outbound External Platform Boundary
        KillSwitchBarrier{"Emergency Kill Switch (Active Guard)"}
        OutboundGuard{"ENABLE_LIVE_PLATFORM_ACTIONS = false"}
        ReadOnlyAPI["YouTube API Adapter (youtube.readonly)"]
    end

    PublicWeb --> WAF
    UntrustedSignals --> WAF
    WAF --> RateLimit --> SecurityHeaders --> AuthBarrier
    AuthBarrier --> TenantScoping --> Services
    Services --> HMACGate --> WORMStorage
    WORMStorage -.-> KMSKeys
    Services --> KillSwitchBarrier --> OutboundGuard --> ReadOnlyAPI
```

---

## 2. Core Security Boundaries

### 2.1 Boundary 1: Authentication & Session Integrity
* **Mechanism:** Cryptographically signed Bearer session tokens (`HMAC-SHA256`).
* **Enforcement:**
  - Token signature is verified against `SESSION_SECRET`.
  - Session expiration is checked against internal issue timestamps.
  - In `NODE_ENV=production`, header-based authentication (`x-user-id`) is completely rejected.
  - Rate limiting enforces exponential backoff after repeated failed login attempts.

---

### 2.2 Boundary 2: Multi-Tenant Data Isolation (Anti-BOLA/IDOR)
* **Threat:** Broken Object-Level Authorization (BOLA) where an operator in Organization A inspects or modifies cases, evidence, or playbooks belonging to Organization B.
* **Mitigation:**
  1. Route middleware extracts and verifies active tenant membership from session context.
  2. SQL queries across all domain services enforce parameterization:
     ```sql
     SELECT * FROM cases WHERE id = ? AND organization_id = ?
     ```
  3. Attempting to query an object belonging to another tenant returns `404 Not Found` (preventing existence enumeration).
  4. Verified in automated test suite: `tests/integration/tenant-isolation.test.ts`.

---

### 2.3 Boundary 3: Forensic Evidence Vault Isolation
* **Threat:** Tampering, premature deletion, or unauthorized extraction of sensitive digital evidence.
* **Mitigation:**
  1. **Streaming SHA-256 Custody:** File content is hashed on the wire; the resulting hash is committed to an append-only ledger before storage is finalized.
  2. **Zero Direct File Access:** Storage directories and S3 buckets reject direct public reads.
  3. **HMAC Download Token Gate:** Downloading evidence requires an authenticated session to generate a time-limited HMAC token (`expires_at` within 300 seconds). Attempting download without a valid token returns `401 Unauthorized`.
  4. **WORM Compliance & Legal Holds:** Deletion of evidence under active legal hold is rejected with HTTP 409 Conflict. Once expired, evidence deletion requires two distinct authorized operators (`two-person deletion`).

---

### 2.4 Boundary 4: External Mutation & Autonomous Action Boundary
* **Threat:** Accidental dispatch of defamatory notices, unauthorized account takedowns, or rogue automated accusations.
* **Mitigation:**
  1. **Strict Code Invariant:** The codebase contains zero autonomous takedown dispatch logic.
  2. **Multi-Role Human Approvals:** Every takedown notice packet requires explicit, separate sign-off from Legal Counsel and Case Managers.
  3. **Controlled Pilot Flags:** `ENABLE_LIVE_PLATFORM_ACTIONS=false` and `PILOT_MODE=true` prevent outbound network calls.
  4. **Emergency Kill-Switch:** Administrative endpoint `/api/integrations/kill-switch` immediately halts all inbound and outbound webhook processing, returning HTTP 503 `KILL_SWITCH_ACTIVE`.

---

### 2.5 Boundary 5: Input Sanitization & SSRF Protection
* **Threat:** Server-Side Request Forgery (SSRF) using victim-reported URLs to scan internal network infrastructure or AWS instance metadata (`169.254.169.254`).
* **Mitigation:**
  - `src/services/monitoring/url-normalization-service.ts` parses and validates all URLs.
  - Denies loopback (`127.0.0.1`), link-local (`169.254.0.0/16`), private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and non-standard schemes (`file://`, `ftp://`).
  - Rejection verified in `tests/security/ssrf-url-validation.test.ts`.
