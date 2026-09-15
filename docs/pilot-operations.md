# Controlled Pilot Operations Standard Operating Procedure (SOP)

## 1. Purpose & Scope

This document establishes the Standard Operating Procedure (SOP) for running **Controlled Pilot Operations** of the **Digital Impersonation Response Desk**. 

The controlled pilot is designed for institutional partner evaluations, synthetic incident simulations, and operational dry-runs within Indian cyber-legal jurisdictions (IT Act 2000 §66D, IT Rules 2021 Rule 3(2)(b), and BNS 2023 §319/§336).

> [!IMPORTANT]
> **Controlled Pilot Scope**: Zero outbound platform submissions, zero live payment card charges, and zero unauthenticated external network requests. All operational workflows execute within local simulation bounds.

---

## 2. Operational Roles & Responsibilities

| Role | Access Level | Primary Responsibilities |
| :--- | :--- | :--- |
| **System Administrator** (`system_admin`) | Global Cross-Tenant | System health monitoring, background worker orchestration, tenant provisioning, entitlement overrides, WAL backup verification. |
| **Organization Owner** (`org_owner`) | Tenant Administrative | Institutional onboarding completion, member invitation & role assignment, plan review, dry-run billing inspection, organization deactivation. |
| **Incident Responder** (`incident_responder`) | Tenant Operational | Case triage, statutory clock initiation, legal review requests, evidence packaging, platform dry-run submission dispatches. |
| **Forensic Analyst** (`analyst`) | Tenant Operational | Evidence ingestion, cryptographic hashing (SHA-256), chain-of-custody verification, re-upload observation logging. |
| **Legal / Compliance Auditor** (`auditor`) | Tenant Read-Only | Audit log review, evidence retention hold management, compliance report generation (Section 79, Form 65B, Chain of Custody). |

---

## 3. Safety Tripwires & Circuit Breakers

The system enforces non-bypassable architectural tripwires:

1. **Zero Live Platform Actions**:
   - `ENABLE_LIVE_PLATFORM_ACTIONS` is locked to `false`. Any attempt to enable live dispatches causes a fatal startup configuration exception (`FatalConfigError`).
   - Submissions execute strictly via `LocalDryRunSubmissionAdapter`, returning deterministic simulated receipts (`SIM-SUB-...`).
2. **Zero Commercial Billing**:
   - `ENABLE_LIVE_BILLING` is locked to `false`.
   - Invoices are generated exclusively by `LocalDryRunBillingProvider` with prominent watermarks: `DRY-RUN SIMULATION ONLY - NO PAYMENT PROCESSED - ZERO COMMERCIAL CHARGES`.
3. **Internal Transactional Outbox**:
   - `ENABLE_LIVE_NOTIFICATIONS` is locked to `false`.
   - Notifications queue in SQLite `notification_outbox` and deliver to the in-app notification center (plus console/file previews).
4. **Hermetic Pre-Flight SSRF Filtering**:
   - Contested URLs undergo IPv4/IPv6 loopback, link-local, private RFC 1918, CGNAT, and AWS/GCP cloud metadata block checks without triggering DNS or HTTP queries.
5. **Fail-Closed Secrets in Production Mode**:
   - Server rejects weak default keys in `pilot` and `production` modes (`SESSION_SECRET`, `DOWNLOAD_TOKEN_SECRET` must be >= 32 characters).

---

## 4. Daily Operational Cadence

### Morning Routine (09:00 IST)
1. **Health Verification**:
   - Check `/health/readiness` to verify database connectivity, storage volumes, and safety flags.
   - Verify worker heartbeats via `/api/admin/workers` in the Operator Console.
2. **Statutory Clock Review**:
   - Inspect active IT Rules 2021 clocks (24h/72h). Flag any clocks in `due_soon` (< 6 hours remaining) or `overdue`.
3. **Usage Quota Inspection**:
   - Review `/api/usage/summary` across active pilot organizations. Ensure storage consumption is below plan caps.

### Midday Routine (14:00 IST)
1. **Case Triage & Re-Upload Review**:
   - Verify new synthetic impersonation reports. Confirm priority tagging (High/Critical for executive impersonation).
   - Check re-upload surveillance records (`/api/re-uploads`) for mirror campaigns.
2. **Notification Outbox Sweep**:
   - Check pending outbox records to ensure in-app delivery latency is under 15 seconds.

### Evening Routine (18:00 IST)
1. **Automated WAL Backup Drill**:
   - Execute backup snapshot and run integrity verification. Confirm SHA-256 database checksum matches the manifest.
2. **Evidence Retention Audit**:
   - Check expired evidence items and verify that items with active legal holds (`retention_holds`) were not purged.

---

## 5. Handling Operational Anomalies

### Anomaly A: Statutory Clock Marked Overdue
- **Symptom**: Alert in in-app notification drawer: `STATUTORY CLOCK OVERDUE: Case CAS-...`.
- **Action**: 
  1. Open the case details and review platform playbook requirements.
  2. Verify if formal legal review was completed.
  3. Execute simulated submission dispatch to record a statutory response timestamp.
  4. Log remediation notes in case notes.

### Anomaly B: Usage Limit Exceeded (`PLAN_LIMIT_EXCEEDED`)
- **Symptom**: Case creation or evidence upload returns HTTP 422 with entitlement error.
- **Action**:
  1. System Admin reviews `/api/usage/summary` and `/api/usage/quota-check`.
  2. If legitimate pilot extension is warranted, System Admin updates entitlements via `PUT /api/admin/entitlements/:orgId`.
  3. Alternatively, trigger dry-run billing invoice preview to observe overage calculation.

### Anomaly C: Emergency Organization Deactivation
- **Symptom**: Partner pilot concludes, or credential misuse is reported.
- **Action**:
  1. System Admin or Org Owner submits soft deactivation via `POST /api/onboarding/deactivate`.
  2. Organization status transitions to `deactivated`. All memberships are marked inactive.
  3. **Data Integrity Guarantee**: Active cases, evidence locker items, and audit logs remain permanently preserved for regulatory and evidentiary compliance.
