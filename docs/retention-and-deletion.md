# Evidence Retention, Legal Holds, and Two-Person Deletion Governance

## 1. Overview
In digital incident response and legal grievance desks, data lifecycle management must balance two competing mandates:
1. **Preservation Mandate**: Ensuring evidence relevant to ongoing litigation, police FIRs, or GAC appeals is never prematurely discarded.
2. **Data Minimization Mandate**: Ensuring unneeded, sensitive digital recordings are securely purged upon expiry of statutory necessity (DPDP Act 2023 compliance).

---

## 2. Retention Periods
By default, evidence items are assigned an expiry date calculated as:
```
retention_until = ingestion_timestamp + DEFAULT_EVIDENCE_RETENTION_DAYS (default: 180 days)
```
Tenants can configure custom retention windows based on organizational policy.

---

## 3. Legal Hold Locks (`evidence_retention_holds`)

### 3.1 Hard Lock Invariant
When an active legal hold is placed on an evidence item:
- The item cannot be deleted under any circumstances.
- Automated retention expiration workers cannot purge the item.
- The item remains accessible for statutory filing and court production.

### 3.2 Role Permissions
- **Placing a Hold**: Permitted to `case_manager`, `legal_reviewer`, `org_admin`, `org_owner`, and `system_admin`.
- **Releasing a Hold**: Strictly restricted to `case_manager`, `legal_reviewer`, `org_owner`, and `system_admin`. Ordinary analysts (`analyst`) and read-only stakeholders (`read_only_stakeholder`) are barred from releasing holds.
- **Audit Requirement**: Placing or releasing a hold mandates a clear text justification recorded in `evidence_access_events` and `audit_events`.

---

## 4. Two-Person Deletion Workflow

To prevent accidental data loss or rogue employee destruction of critical evidence, the system enforces a strict two-person separation of duties for all evidence deletions:

```
[ Step 1: Deletion Request ]
  Operator (Analyst or Case Manager) initiates request
  State transitions: available ──► deletion_requested
  Reason logged to audit ledger.
         │
         ▼
[ Step 2: Legal Hold Check ]
  IF legal_hold === 1 ──► [ REJECT 409 Conflict: Active Legal Hold ]
         │
         ▼
[ Step 3: Dual Authorization Approval ]
  Different authorized actor (org_owner, legal_reviewer, system_admin) reviews justification
  Calls `POST /api/evidence/:id/approve-deletion`
         │
         ▼
[ Step 4: Storage Purge & Metadata Tombstone ]
  1. Binary file payload purged from physical storage.
  2. Database record marked status = 'deleted', deleted_at = now, storage_key = NULL.
  3. Tamper-evident hash and custody log preserved indefinitely as an audit tombstone.
```
