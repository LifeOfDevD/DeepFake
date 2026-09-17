# EXT-001: Independent External Security Assessment Scope

**Target Application:** Digital Impersonation Response Desk  
**Target Release:** `v1.0.0-controlled-pilot-rc2` (Commit: `e7db64c`)  
**Deployment Enclave:** Private Staging Mesh (`http://100.100.25.15:4001`) / Isolated Staging Host (`http://127.0.0.1:4001`)  
**Target Assessor:** Appropriately Qualified Independent External Security Firm / Assessor  
**Assessment Standard:** OWASP Top 10 (2021), OWASP API Security Top 10 (2023), OWASP ASVS v4.0 Level 2  
**Date of Document:** 2026-09-16  

---

## 1. Engagement Purpose

The Digital Impersonation Response Desk handles highly sensitive statutory takedown notices, digital impersonation incident tracking, and evidentiary preservation for executive leadership and professional organizations under the Indian Information Technology Act, 2000 and IT Rules, 2021.

Before the system may be promoted to General Availability (GA), an appropriately qualified independent external security assessment firm must perform black-box, gray-box, and white-box security testing against the frozen release candidate.

Antigravity and the engineering team prepare the target scope, architecture documentation, test credentials, and testing rules of engagement. Under no circumstances will internal testing be substituted for or represented as independent external testing.

---

## 2. In-Scope Target Attack Surface

The external assessment team is authorized to evaluate the following components:

### 2.1 API & Application Endpoints
All API endpoints exposed under the `/api` and `/healthz` prefixes on port 4001:
- **Authentication & Identity:**
  - `POST /api/auth/login` (Account lockout, brute force, timing attacks)
  - `POST /api/auth/logout` (Session invalidation, token revocation)
  - `GET /api/auth/me` (Profile disclosure, privilege reflection)
  - `GET /api/auth/demo-users` (Staging-only discovery endpoint)
- **Multi-Tenant Case Operations:**
  - `GET /api/cases`, `POST /api/cases`, `GET /api/cases/:id`, `PATCH /api/cases/:id/status`
  - `POST /api/cases/:id/notes`, `GET /api/cases/:id/notes`
  - Cross-tenant object reference attacks (IDOR / BOLA) between `org_apex_health_01` and `org_bharatfin_02`
- **Evidence Management & Chain of Custody:**
  - `POST /api/cases/:caseId/evidence` (Multipart file upload and JSON source capture)
  - `GET /api/cases/:caseId/evidence`, `GET /api/evidence/:evidenceId`
  - `GET /api/evidence/:evidenceId/download-token` (HMAC token generation)
  - `GET /api/evidence/:evidenceId/download` (HMAC signature verification, token expiration)
  - `POST /api/evidence/:evidenceId/legal-hold`, `DELETE /api/evidence/:evidenceId/legal-hold`
  - `POST /api/evidence/:evidenceId/deletion-request`
  - `POST /api/evidence/:evidenceId/approve-deletion` (Two-person authorization boundary)
- **Monitoring, Ingestion & Signal Intake:**
  - `GET /api/monitoring/subjects`, `POST /api/monitoring/subjects`
  - `POST /api/monitoring/signals/ingest`, `POST /api/monitoring/signals/batch`
  - `GET /api/monitoring/reviews`, `POST /api/monitoring/reviews/:id/decision`
  - `POST /api/monitoring/simulate-cycle`
- **Integrations & Safety Kill-Switch:**
  - `GET /api/integrations/kill-switch`
  - `POST /api/integrations/kill-switch` (Administrative emergency toggle)
  - `POST /api/integrations/youtube/webhook/:connectionId` (Public WebSub webhook endpoint)
  - `GET /api/integrations/status`
- **Grievance Takedown Generation:**
  - `GET /api/cases/:id/submission-packet` (Canonical JSON manifest & SHA-256 digest)
  - `POST /api/cases/:id/simulate-submission` (Dry-run dispatch simulation)
- **Audit Ledger:**
  - `GET /api/audit-events` (Immutable ledger querying and integrity)

### 2.2 Client-Side Frontend (SPA)
- `GET /`, `GET /index.html`, `GET /app.js`
- Content Security Policy evaluation (specifically `scriptSrc` inclusion of `'unsafe-eval'` and `https://cdn.tailwindcss.com`)
- Clickjacking protection (`X-Frame-Options: DENY`, `frame-ancestors 'none'`)
- DOM-based Cross-Site Scripting (DOM XSS) in incident rendering, notes, and audit log tables

---

## 3. Explicit Attack Domains & Test Scenarios

The external assessor is requested to focus testing on the following high-risk vulnerability domains:

1. **Horizontal Cross-Tenant Authorization Bypass (BOLA / IDOR):**
   - Attempting to view, mutate, attach evidence to, or close cases belonging to `org_bharatfin_02` while authenticated as a user of `org_apex_health_01`.
   - Tampering with `X-Organization-ID` HTTP headers to spoof organizational tenancy.
2. **Cryptographic Evidence Custody & Legal Hold Immutability:**
   - Attempting to delete evidence under active statutory legal hold (`legal_hold = 1`).
   - Attempting to approve an evidence deletion request using the same persona that requested the disposal (violating the mandatory Two-Person separation of duties rule).
   - Downloading evidence items without a valid, unexpired HMAC download token.
3. **Server-Side Request Forgery (SSRF) & Cloud Metadata Access:**
   - Submitting cloud instance metadata URLs (`http://169.254.169.254/latest/meta-data/`), loopback notations (`127.0.0.1`, `0x7f000001`, `http://localhost/`), CGNAT addresses (`100.64.0.0/10`), and private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) in evidence source URL capture.
4. **Emergency Ingestion Kill-Switch Integrity:**
   - Verifying that when an administrator arms the global kill switch (`POST /api/integrations/kill-switch`), all public webhook ingestions return HTTP 503 and zero signals are ingested into the database.
   - Attempting to toggle the kill switch using non-administrative roles (e.g., analyst, read-only stakeholder).
5. **Authentication & Session Management:**
   - Attempting token forgery, HMAC signature truncation, replay of expired tokens, and brute-force attacks against `/api/auth/login` to test Account Lockout thresholds.

---

## 4. Out-of-Scope Exclusions & Guardrails

To ensure safety, data integrity, and compliance with external platform terms, the following activities are strictly **EXCLUDED**:
1. **No Real Platform Takedown or Grievance Submissions:** Assessor must NOT attempt live API calls to Meta Graph API, YouTube Reporting API, Google Trust & Safety, Telegram, or X API. The staging application operates in dry-run simulation mode (`ENABLE_LIVE_PLATFORM_ACTIONS=false`).
2. **No Real Victim, Executive, or Doctor PII:** All testing must utilize the pre-seeded synthetic organizations (`Apex Healthcare`, `BharatFin`) and synthetic incident records.
3. **No Distributed Denial of Service (DDoS) Against Mesh:** Volumetric network flooding against Tailscale/WireGuard infrastructure is prohibited.
4. **No Destructive Database Erasure:** Assessor must not execute host-level filesystem deletion of `./data/response_desk_staging.sqlite`.
