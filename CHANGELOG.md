# Changelog

All notable changes to the **Digital Impersonation Response Desk** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.0.0-controlled-pilot-rc2] - 2026-09-16

### Commit: `e7db64ce58111a6a5f1bbf6b49d0b3e6dc6fb2db`
### Status: Active Controlled Pilot Baseline (General Availability Strictly Withheld)

#### Fixed & Hardened
* **Content Security Policy (CSP):** Adjusted CSP script and style directives in `src/security/security-headers.ts` to allow local Tailwind CSS JIT compiler runtime execution in private mesh staging without weakening API protection.
* **Frontend UI Resiliency:** Added defensive null checks and DOM element guards in `src/client/app.js` for packet modal controls and simulated dispatch triggers.
* **Tenant Isolation Endpoints:** Added parameterized tenant scoping (`WHERE organization_id = ?`) to `src/services/escalation-service.ts` and `src/services/reupload-monitoring-service.ts`, mounting authenticated endpoints `GET /api/escalations` and `GET /api/re-uploads`.

#### Verified
* **Master Graph Verification:** Passed 52/52 automated verification checks in `scripts/execute-master-graph.cjs`.
* **Browser CDP Smoke Check:** Validated 100% styled UI, role resolution, and zero uncaught exceptions via Headless Chrome over CDP against private mesh (`http://100.100.25.15:4001`).
* **Emergency Kill-Switch In-Staging:** Verified active kill-switch tripwire; confirmed inbound webhooks immediately return HTTP 503 `KILL_SWITCH_ACTIVE`.
* **Adversarial Security QA:** Defeated 7/7 fresh-context adversarial exploit vectors (signature tampering, token forgery, cross-tenant IDOR, legal hold deletion bypass, SQLi, SSRF AWS metadata).

---

## [v1.0.0-rc1] - 2026-09-14

### Commit: `bfe0885bec0f1dd317935001fe8452bd36d16952`
### Status: Initial Frozen Release Candidate Baseline

#### Added
* **Incident Intake & Triage Engine:** Structured intake pipeline for digital impersonation and deepfake incidents, automated threat severity scoring, and statutory countdown timers (IT Rules 2021 Rule 3(2) 24h ack, 72h resolution).
* **Forensic Evidence Vault:** Streaming SHA-256 hashing during upload, magic-byte MIME validation, time-limited HMAC download tokens, and immutable audit logs.
* **WORM Storage & Legal Hold:** Write-Once-Read-Many simulation in local storage and S3 Object Lock COMPLIANCE integration (`terraform/s3_object_lock.tf`); two-person deletion workflow for expired evidence; deletion blocked on active legal holds.
* **Statutory Playbook Engine:** Notice formulations for 9 global platforms (Meta, Instagram, YouTube, X, Telegram, LinkedIn, WhatsApp, Google, GitHub) mapping statutory categories under the IT Act, 2000 and IT Rules 2021.
* **Multi-Facet Approval Governance:** Separation of duty requiring explicit Legal, Evidence, and Case Manager sign-offs before takedown notice preparation.
* **Controlled Integrations:** Read-only YouTube API adapter with strict `youtube.readonly` scope, inbound WebSub webhook signature verification, AES-256-GCM encrypted token storage, and emergency kill-switch.
* **Multi-Tenant SaaS Infrastructure:** Organization scoping, role-based access control (RBAC), subscription plan quotas, granular usage metering, and dry-run billing simulation.
* **Background Worker Manager:** 8 persistent workers operating with distributed SQLite lease locks for statutory clocks, signal ingestion, candidate scoring, integrity audits, provider sync, webhook retries, retention, and usage rollups.
* **Automated Test Suite:** 80 test files containing 447 tests across unit, integration, database migrations, security, and resilience domains.
