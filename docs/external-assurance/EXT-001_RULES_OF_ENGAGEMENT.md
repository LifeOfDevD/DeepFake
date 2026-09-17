# EXT-001: Rules of Engagement (RoE) for Security Assessor

**Target Application:** Digital Impersonation Response Desk  
**Target Environment:** Private Staging Mesh (`http://100.100.25.15:4001`) / Isolated Staging Host (`http://127.0.0.1:4001`)  
**Target Release:** `v1.0.0-controlled-pilot-rc2`  
**Date:** 2026-09-16  

---

## 1. Primary Points of Contact & Escalation

| Role | Contact Entity | Escalation Trigger |
|---|---|---|
| **Incident Response Lead** | `security-ops@desk.example` | General testing queries, access issues |
| **Emergency Lead / Release Owner** | `incident-commander@desk.example` | Discovery of Critical (CVSS >= 9.0) exploit, unhandled server crash |
| **Infrastructure Lead** | `cloud-ops@desk.example` | Staging mesh connectivity, Tailscale peer authorization |

---

## 2. Permitted Testing Activities

The external testing team is explicitly authorized to execute:
1. **Automated Vulnerability Scanning:** Dynamic Application Security Testing (DAST) using Burp Suite Professional, OWASP ZAP, or similar tools, capped at 50 requests per second to avoid saturating Node.js single-threaded event loop.
2. **Manual Penetration Testing:** Business logic manipulation, multi-step workflow bypasses, authorization boundary testing, parameter fuzzing, and cryptographic token tampering.
3. **Multi-Tenant Boundary Probing:** Horizontal privilege escalation and IDOR attacks between Organization A (`Apex Healthcare`) and Organization B (`BharatFin`).
4. **Input Fuzzing:** SQL injection strings, XSS vectors, template injection, path traversal payloads, and malformed JSON bodies.
5. **SSRF Probing:** Submitting internal IPs, link-local metadata endpoints, and DNS rebinding hosts into the evidence source URL capture endpoint.

---

## 3. Strict Prohibitions & Safety Boundaries

The following activities are strictly **PROHIBITED**:
1. **Volumetric Denial of Service (DoS / DDoS):** Assessor must not execute SYN floods, UDP floods, or volumetric HTTP floods intended to degrade network availability.
2. **Live External Platform Interaction:** The staging application is configured with mock adapters (`MOCK_PLATFORM_ADAPTERS=true`). Assessor must NOT reconfigure or attempt to force the application to make live outbound API calls to Meta, Google, X, or Telegram.
3. **Destructive Host Filesystem Operations:** Assessor must not execute host operating system exploits to delete database files (`response_desk_staging.sqlite`) or corrupt disk storage.
4. **Physical or Social Engineering Attacks:** Attacks against personnel, facilities, or physical workstations are strictly out of scope.

---

## 4. Critical Finding Escalation Protocol (P0 / CVSS >= 9.0)

If the assessment team identifies an exploit of critical severity—defined as:
- Unauthenticated Remote Code Execution (RCE);
- Total cross-tenant data compromise (accessing all tenants without credentials);
- Complete cryptographic token forgery allowing arbitrary administrator impersonation; or
- SQL injection resulting in arbitrary file write or command execution;

**The assessor must:**
1. Immediately pause testing on the affected component.
2. Encrypt the proof-of-concept (PoC) using the security team's PGP key.
3. Transmit an emergency notification to `incident-commander@desk.example` within two (2) hours of confirmation.
4. Refrain from testing that specific vector further until remediation and re-testing are coordinated.

---

## 5. Deliverable & Reporting Requirements

Upon completion of testing, the assessment firm must provide:
1. **Formal Executive Summary:** High-level posture assessment, CVSS distribution chart, and maturity rating.
2. **Technical Findings Ledger:** Each finding must detail:
   - Unique Finding ID (e.g., `EXT-FIND-001`)
   - Vulnerability Title & Classification (CWE / OWASP Category)
   - CVSS v3.1 Base Score and Vector String
   - Affected Endpoint, HTTP Method, and Parameter
   - Step-by-Step Reproduction Instructions
   - Raw HTTP Request and Response Evidence with Redacted Secrets
   - Root Cause Analysis & Prescriptive Remediation Guidance
3. **Formal Attestation Letter:** Signed letter by lead assessor confirming scope, testing dates, and whether critical/high findings were identified or resolved.
