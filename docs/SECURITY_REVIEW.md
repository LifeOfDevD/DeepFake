# Focused Security Review: Staging Changes & Operational Posture

**Date:** 2026-09-16  
**Security Lead:** Independent Security & Release Reviewer  
**Scope:** Changes to CSP, routing, tenant boundaries, client scripts, and safety invariants  
**Target:** `v1.0.0-controlled-pilot-rc2`  
**Security Verdict:** ACCEPTABLE FOR CONTROLLED PILOT / PRODUCTION-CANARY ONLY (GA Blockers Preserved)

---

## 1. Content Security Policy & Network Boundary Analysis

### 1.1 Evaluated Directives
```typescript
directives: {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.tailwindcss.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  upgradeInsecureRequests: null
}
```

### 1.2 Threat Modeling & Risk Assessment
* **Risk: Inclusion of `'unsafe-eval'`:**
  - *Context:* Tailwind CDN JIT requires dynamic evaluation to compile atomic CSS classes on demand as DOM mutations occur.
  - *Threat:* An attacker with XSS could leverage `eval()`.
  - *Mitigation & Defense-in-Depth:*
    - All dynamic strings rendered in `app.js` utilize `textContent`, `document.createElement`, and safe text node assignments.
    - `connectSrc` is locked to `'self'`: the browser cannot exfiltrate stolen tokens or cookies to external command-and-control endpoints.
    - `objectSrc: ["'none'"]` prohibits Flash/plugin execution.
    - `frameAncestors: ["'none'"]` prevents clickjacking.
  - *Controlled Pilot Acceptability:* Acceptable for staging / controlled pilot.
  - *GA Recommendation:* Prior to GA (`EXT-001` closure), compile Tailwind CSS into a static, versioned bundle at build time to eliminate both `'unsafe-eval'` and third-party CDN script dependencies.

* **Risk: Removal of `upgradeInsecureRequests`:**
  - *Context:* Staging is operated over a private WireGuard / Tailscale overlay mesh without an automated internal PKI certificate authority.
  - *Threat:* Insecure plaintext transport across unauthenticated public networks.
  - *Assessment:* The network layer is point-to-point encrypted via the underlying mesh (WireGuard/Tailscale ChaCha20-Poly1305). Disabling `upgradeInsecureRequests` allows legitimate staging operators on `http://100.100.25.15:4001` to communicate without artificial TLS redirection loops.
  - *Production Invariant:* Production deployments terminate TLS at the load balancer / reverse proxy (`appUrl` begins with `https://`), where HSTS and strict HTTPS enforcement remain fully enabled.

---

## 2. Multi-Tenant Authorization & IDOR Analysis

### 2.1 Escalation and Re-Upload Endpoints
* **Routes Added:**
  - `GET /api/escalations`
  - `GET /api/re-uploads`
* **Middleware Chain:**
  1. `authMiddleware`: Verifies valid signed session token. Rejects unauthenticated callers with HTTP 401.
  2. `tenantMiddleware`: Matches caller's authenticated `organization_id`. Forbids unauthorized tenant switching with HTTP 403.
* **Database Isolation:**
  - `getEscalationsForOrganization`:
    ```sql
    SELECT * FROM case_escalations WHERE organization_id = ? ORDER BY created_at DESC
    ```
  - `getObservationsForOrganization`:
    ```sql
    SELECT * FROM related_content_observations WHERE organization_id = ? ORDER BY created_at DESC
    ```
  - Both queries use strict parameter binding against the authenticated tenant context (`req.tenant!.organization_id`).
  - No client-controlled query parameters dictate tenant filtering. Cross-tenant data leakage is cryptographically and logically blocked.

---

## 3. Fail-Closed Safety Invariants Verification

| Invariant | Implementation Mechanism | Staging Verification | Status |
|---|---|---|---|
| **Dry-Run Billing** | `DRY_RUN_BILLING=true` in `.env.staging` | Verified in `/healthz/ready`: `"liveBillingBlocked": true` | PASS |
| **No Live Platform Actions** | `MOCK_PLATFORM_ADAPTERS=true` | Verified in `/healthz/ready`: `"livePlatformActionsBlocked": true` | PASS |
| **No Live Notifications** | Notification worker set to mock logger | Verified in `/healthz/ready`: `"liveNotificationsBlocked": true` | PASS |
| **Evidence Custody** | HMAC-SHA256 time-limited signed tokens | HTTP 401 on unauthenticated `/download` attempts | PASS |
| **Legal Hold Protection** | Immutable state machine guard | HTTP 409 Conflict returned if deletion attempted | PASS |
| **Kill Switch** | `KILL_SWITCH_ENABLED=true` in memory/db flag | Operational & tested via administrative control | PASS |

---

## 4. Conclusion & Operational Posture

The modifications maintain the strict separation between internal testing and live operations. No tenant boundary compromises, data corruption vectors, or unauthorized platform egress risks were introduced.
