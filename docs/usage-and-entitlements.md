# Usage Metering, Quotas & Commercial Entitlements

## 1. Overview

The **Digital Impersonation Response Desk** features a multi-tenant entitlement and metering engine designed for controlled pilot evaluations and structured commercial tiers.

Every tenant is bound to a plan tier with enforced hard limits, feature flags, and transparent overage schedules.

---

## 2. Commercial Plan Catalog

| Plan Parameter | Controlled Pilot (`pilot`) | Professional (`professional`) | Enterprise Dedicated (`enterprise`) |
| :--- | :--- | :--- | :--- |
| **Monthly Base Price** | **₹0** (Synthetic Validation) | **₹49,000 / month** | **₹1,49,000 / month** |
| **Target Customer** | Pilot Partners & Evaluation Desks | Corporate Security & Legal Responders | Conglomerates & Multi-Brand Desks |
| **Active Case Limit** | 25 active cases | 100 active cases | 500 active cases |
| **User Seats (Members)** | 10 users | 25 users | 100 users |
| **Monthly Evidence Uploads**| 100 uploads / month | 500 uploads / month | 2,500 uploads / month |
| **Evidence Storage Quota** | 5 GB | 25 GB | 100 GB |
| **Simulated Submissions** | 50 dispatches / month | 250 dispatches / month | 1,000 dispatches / month |
| **Statutory Clock Tracking**| Included (Rule 3(2)(b)) | Included (Rule 3(2)(b)) | Included (Custom SLAs) |
| **Evidence Locker** | Included (SHA-256 Custody) | Included (SHA-256 Custody) | Included (Dedicated Encryption) |
| **Audit & Export** | Included | Included | Included (Syslog / SIEM API) |

---

## 3. Overage Schedule (INR)

When an organization exceeds plan allowances, metered overages are calculated dynamically for invoice preview simulation:

| Metric | Controlled Pilot | Professional Tier | Enterprise Tier |
| :--- | :--- | :--- | :--- |
| **Additional Active Case** | ₹0 (Hard Capped) | ₹500 / case | ₹350 / case |
| **Additional Team Seat** | ₹0 (Hard Capped) | ₹1,500 / user | ₹1,000 / user |
| **Additional Storage (GB)**| ₹0 (Hard Capped) | ₹100 / GB / month | ₹75 / GB / month |
| **Additional Submission** | ₹0 (Hard Capped) | ₹250 / dispatch | ₹150 / dispatch |

---

## 4. Feature Flags Matrix

Features are gated per tenant via the `pilot_entitlements.enabled_features` array:

```json
[
  "evidence_locker",
  "statutory_clocks",
  "platform_playbooks",
  "dry_run_submissions",
  "reupload_observations",
  "retention_automation",
  "export",
  "api_access",
  "advanced_audit_reports"
]
```

### Feature Gating Rules
- Attempting to access an unassigned feature throws `EntitlementError: FEATURE_DISABLED` with HTTP 403.
- All 9 core features are enabled by default during the Controlled Pilot to permit comprehensive institutional validation.

---

## 5. Quota Enforcement & Guardrails

The `EntitlementService` enforces quotas inline before mutating database records:

1. **`assertCanCreateCase(orgId)`**:
   - Counts cases where `status != 'closed'`.
   - Rejects creation with `PLAN_LIMIT_EXCEEDED` (HTTP 422) if count >= `max_active_cases`.
2. **`assertCanUploadEvidence(orgId, byteSize)`**:
   - Checks both monthly upload count and total non-deleted storage bytes.
   - Throws descriptive error if storage quota would be exceeded:
     `Storage capacity exceeded: current storage is X.X MB of Y.Y MB limit.`
3. **`assertCanSimulateSubmission(orgId)`**:
   - Checks monthly submission count from `usage_events`.
4. **`assertCanInviteUser(orgId)`**:
   - Checks active memberships count against `max_users`.

---

## 6. Usage Metering & Reporting API

### 6.1 Event Ingestion
Raw usage is recorded idempotently in `usage_events` with unique `idempotency_key` deduplication:

```http
POST /api/usage/record
Content-Type: application/json
Authorization: Bearer <user_token>

{
  "event_type": "evidence_uploaded",
  "quantity": 1,
  "resource_id": "ev_apex_001"
}
```

### 6.2 Rollup & Daily Aggregates
The `UsageAggregationWorker` automatically rolls raw events into `usage_daily_aggregates` daily summaries.

### 6.3 Usage Export
- **JSON Format**: `GET /api/usage/export?format=json`
- **CSV Format**: `GET /api/usage/export?format=csv` (generates downloadable tabular spreadsheet)
