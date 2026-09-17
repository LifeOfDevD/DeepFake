# Security Policy

## Supported Versions

The Digital Impersonation Response Desk is currently in **Controlled Pilot / Production-Canary** status.

| Version | Supported | Status |
|---|---|---|
| `v1.0.0-controlled-pilot-rc2` | :white_check_mark: | Active Controlled Pilot Baseline |
| `< v1.0.0-rc1` | :x: | Deprecated / Milestone Only |

---

## Reporting a Vulnerability

We take the security of the Digital Impersonation Response Desk seriously. If you believe you have found a security vulnerability in this repository, please follow responsible disclosure principles.

### How to Report
* **Private Security Advisory:** Please report security vulnerabilities privately via GitHub's [Private Vulnerability Reporting](https://github.com) feature on this repository.
* **Alternative Contact:** If private advisory reporting is unavailable, please open a GitHub Issue with the title prefix `[SECURITY DISCLOSURE]` containing *only high-level non-exploitative contact coordination details*, and an engineering team member will establish secure encrypted communication.
* **Do NOT publicly post:**
  - Proof-of-concept exploit scripts
  - Specific payloads that could compromise live systems
  - Secrets, private keys, or internal infrastructure details

### What to Include in Your Report
To help us triage and resolve the issue quickly, please include:
1. **Description:** A detailed explanation of the vulnerability and potential impact.
2. **Component:** Affected routes, middleware, services, or cryptographic primitives.
3. **Reproduction Steps:** Step-by-step instructions or minimal test code to reproduce the behavior in a local sandbox.
4. **Environment:** Node.js version, OS, and configuration flags.
5. **Mitigation:** Any proposed code remediations or architectural fixes.

---

## Security Invariants Enforced in This Repository

When reviewing or contributing to this project, note that the following security invariants are strictly non-negotiable:
1. **Zero Autonomous Actions:** The system never autonomously files takedowns, dispatches legal notices, or contacts external platforms without explicit, human-reviewed approval.
2. **Multi-Tenant Isolation:** All database queries accessing tenant data must be explicitly parameterized with `organization_id`. Direct object references (BOLA/IDOR) are strictly rejected.
3. **Forensic Integrity:** Evidence objects are immutably hashed with streaming SHA-256 upon ingestion. Object deletion under active legal hold is rejected with HTTP 409 Conflict.
4. **Controlled Pilot Restrictions:** Outbound live platform mutations (`ENABLE_LIVE_PLATFORM_ACTIONS`), live billing (`ENABLE_LIVE_BILLING`), and external notifications (`ENABLE_LIVE_NOTIFICATIONS`) remain disabled.
5. **Fail-Closed Production:** In `NODE_ENV=production`, the application refuses to boot if secrets are weak (< 32 characters) or contain development prefixes.
