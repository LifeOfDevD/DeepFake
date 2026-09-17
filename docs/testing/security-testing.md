# Security Testing & Automated Verification

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Test Suite Directory:** `tests/security/` (18 files • 112 tests)  

---

## 1. Security Test Architecture

Security testing is automated and integrated into every continuous integration run. It encompasses four specialized domains:

```text
tests/security/
├── auth-hardening.test.ts             # HMAC tokens, expiry, header rejection in prod
├── deletion-two-person.test.ts        # Two-person deletion, legal hold overrides
├── download-token-security.test.ts    # Short-lived token validity, replay prevention
├── evidence-safety.test.ts            # Magic byte validation, MIME types
├── evidence-state-machine.test.ts     # Immutable state transition guards
├── foreign-keys-custody.test.ts       # Database relational integrity
├── independent-verification.test.ts   # 11 targeted red-team exploit vectors
├── input-validation.test.ts           # XSS, SQLi, and parameter tampering
├── monitoring-security.test.ts        # Signal spoofing, rate limiting
├── phase3-security-rbac.test.ts       # Intake and triage RBAC
├── phase4-approvals-rbac.test.ts      # Multi-facet separation of duty
├── phase8-security-audit.test.ts      # OAuth token encryption (AES-256-GCM)
├── pilot-security.test.ts             # Controlled pilot guards (0 live mutations)
├── preflight-hardening.test.ts        # Production preflight config checks
├── production-hardening.test.ts       # Rate limiting, account lockout, security headers
├── red-team.test.ts                   # Bounded adversarial attack simulation
├── retention-worker.test.ts           # Statutory 180-day WORM expiration
├── reupload-monitoring.test.ts        # Post-takedown URL normalization & tracking
├── ssrf-url-validation.test.ts        # AWS metadata & private IP denial
└── streaming-upload-limits.test.ts    # 50MB payload limit enforcement
```

---

## 2. Key Verified Invariants

* **Fail-Closed Secrets (`preflight-hardening.test.ts`):** Verifies that the server throws fatal errors on boot if `SESSION_SECRET` is less than 32 characters or contains dev prefixes in production.
* **Separation of Duty (`phase4-approvals-rbac.test.ts`):** Confirms that a single user cannot self-approve a high-severity takedown across both Legal Counsel and Evidence Specialist facets.
* **SSRF Prevention (`ssrf-url-validation.test.ts`):** Tests 9 hostile IP formats (including `http://169.254.169.254`, `http://[::ffff:169.254.169.254]`, `http://127.0.0.1`, and decimal encoded IPs), confirming all are rejected with `HTTP 400 Bad Request`.
* **Zero Autonomous Mutations (`pilot-security.test.ts`):** Confirms that attempting to trigger notice dispatch results in `simulated_submitted` with 0 outbound network requests.
