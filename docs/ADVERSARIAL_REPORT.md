# Adversarial QA Report: Bounded Negative Testing & Security Controls

**Target Release:** `v1.0.0-controlled-pilot-rc2`  
**Deployment:** `http://127.0.0.1:4001` / `http://100.100.25.15:4001`  
**Environment:** Staging / Controlled Pilot Mesh  
**Assessment Date:** 2026-09-16  
**Status:** ALL ADVERSARIAL CHECKS PASSED (7/7)  

---

## 1. Executive Summary

This report documents the fresh-context adversarial tests executed against the running staging application instance. Tests verified authentication boundaries, multi-tenant data isolation, statutory legal hold protections, input validation robustness, and Server-Side Request Forgery (SSRF) defense-in-depth.

All 7 negative test scenarios executed cleanly, demonstrating strict fail-closed behavior across all application layers.

---

## 2. Test Results Matrix

| Test ID | Boundary Tested | Attack / Adversarial Vector | Expected Response | Observed Response | Status |
|---|---|---|---|---|---|
| **ADV-001** | Authentication | Omission of `Authorization` header on protected endpoints (`/api/cases`) | HTTP 401 Unauthorized | HTTP 401 (`UNAUTHORIZED`) | **PASS** |
| **ADV-002** | Authentication | Tampered token cryptographic signature | HTTP 401 Unauthorized | HTTP 401 (`Bearer authentication failed`) | **PASS** |
| **ADV-003** | Multi-Tenancy | Cross-tenant header spoofing (`X-Organization-ID: org_bharatfin_02` sent by Apex Health user) | HTTP 403 Forbidden | HTTP 403 (`Forbidden`) | **PASS** |
| **ADV-004** | Multi-Tenancy / IDOR | Direct object access attempt to case belonging to Org B (`case_bharatfin_2026_003`) by Org A user | HTTP 404 Not Found (zero tenant existence leakage) | HTTP 404 (`CASE_NOT_FOUND`) | **PASS** |
| **ADV-005** | Workflow Safety | Deletion request submitted against evidence under active statutory legal hold | HTTP 409 Conflict | HTTP 409 (`ACTIVE_LEGAL_HOLD_PREVENTS_DELETION`) | **PASS** |
| **ADV-006** | Input Hardening | SQL injection payload in search query (`' OR '1'='1`) | HTTP 200 with parameterized SQL execution | HTTP 200 (Clean results, 0 syntax errors) | **PASS** |
| **ADV-007** | Network / SSRF | AWS Link-Local metadata URL (`http://169.254.169.254/latest/meta-data/`) injected into source URL evidence | HTTP 400 Bad Request | HTTP 400 (`INVALID_SOURCE_URL: Private, loopback, link-local, and reserved IPv4 addresses are prohibited`) | **PASS** |

---

## 3. Detailed Boundary Analysis

### 3.1 Authentication & Signature Verification (ADV-001, ADV-002)
- Session tokens are structured as HMAC-SHA256 signed payloads (`desk_tok_<base64url(payload)>.<signature>`).
- Any tampering with the payload or signature causes `crypto.timingSafeEqual` comparison to fail immediately, rejecting the caller with HTTP 401 before any tenant or route logic executes.

### 3.2 Tenant Isolation & Zero-Leakage IDOR Protection (ADV-003, ADV-004)
- When an authenticated user passes an `X-Organization-ID` header differing from their validated membership organization, `tenantMiddleware` rejects the request with HTTP 403 Forbidden.
- In IDOR attempts where an operator specifies an arbitrary foreign case ID (e.g. `case_bharatfin_2026_003`), the service scopes the SQL query to `WHERE id = ? AND organization_id = ?`. Because the row does not match the authenticated tenant, HTTP 404 is returned. This prevents attackers from enumerating valid resource IDs across tenants.

### 3.3 Statutory Legal Hold Immutability (ADV-005)
- Under the evidence state machine, applying a legal hold sets `legal_hold = 1` and creates an audit record.
- Any subsequent call to `/api/evidence/:id/delete-request` or `/api/evidence/:id/approve-deletion` checks the hold flag and immediately aborts with HTTP 409 Conflict, preserving evidentiary chain of custody.

### 3.4 SSRF & Input Sanitization (ADV-006, ADV-007)
- `ManualSourceCaptureProvider` analyzes all URLs against IP address octet values and hostname blocks.
- Cloud metadata IP ranges (`169.254.0.0/16`), loopbacks (`127.0.0.0/8`), CGNAT (`100.64.0.0/10`), and private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are blocked with HTTP 400.
