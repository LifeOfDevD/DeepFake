# Institutional Customer Onboarding & Offboarding Lifecycle

## 1. Overview

The **Digital Impersonation Response Desk** provides a structured onboarding and offboarding lifecycle tailored for institutional partners, legal teams, and corporate brand security desks.

Onboarding ensures every participating organization establishes legal mandates, role segregation, and platform escalation baselines before handling live synthetic incident responses.

---

## 2. The 7-Step Institutional Onboarding Checklist

Each organization maintains a persistent checklist in `organizations.onboarding_checklist`:

| Step | Identifier | Purpose & Requirement | Verification Criteria |
| :---: | :--- | :--- | :--- |
| **1** | `jurisdiction_verified` | Primary jurisdiction and operational timezone configured | Defaults to `IN-DL` and `Asia/Kolkata` for Indian cyber-law. |
| **2** | `mandate_uploaded` | Proof of legal authority or letter of authorization (LOA) | Upload of signed corporate representation mandate. |
| **3** | `brand_assets_identified` | Target brands, executive names, and protected domains registered | Verified list of protected identity assets. |
| **4** | `escalation_channels_configured`| Platform Grievance Officer and Nodal Officer channels mapped | Grievance emails, portals, and emergency escalation paths defined. |
| **5** | `roles_provisioned` | Multi-role security team invitations dispatched | At least one Responder, Analyst, and Auditor invited. |
| **6** | `statutory_baseline_agreed` | Understanding of IT Rules 2021 statutory clock timelines | Operator acknowledgment of 24h/72h statutory response clocks. |
| **7** | `dry_run_dispatched` | Execution of end-to-end dry-run submission simulation | Successful generation and simulated dispatch of takedown packet. |

### Updating Checklist Progress
```http
PATCH /api/onboarding/checklist
Content-Type: application/json
Authorization: Bearer <org_owner_token>

{
  "item_key": "mandate_uploaded",
  "completed": true
}
```

---

## 3. Cryptographic Team Invitations

User provisioning follows a secure, single-use invitation token flow.

### 3.1 Invitation Lifecycle
1. **Invite Generation**: An Org Owner invites a team member specifying `email` and `role`.
2. **Cryptographic Hashing**: A 64-character random hex token is generated. Only the SHA-256 hash is stored in `organization_invitations.token_hash`.
3. **Invitation Delivery**: An invitation link containing the unhashed token is routed via the Transactional Notification Outbox (`notification_type = 'invitation'`).
4. **Acceptance**: The invitee submits full name and password to `/api/onboarding/invitations/accept`. The token is validated against the stored hash and marked `accepted`.
5. **Revocation**: Org Owners can revoke pending invitations at any time before acceptance.

### 3.2 Invite Team Member API
```http
POST /api/onboarding/invitations
Content-Type: application/json
Authorization: Bearer <org_owner_token>

{
  "email": "counsel@enterprise.example",
  "role": "auditor"
}
```

---

## 4. Archival Offboarding & Soft Deactivation

When an institutional pilot concludes or an organization leaves the platform, the service performs **Archival Soft Deactivation** rather than hard deletion.

> [!CAUTION]
> **Chain of Custody & Evidence Retention Mandate**:
> Section 79 of the IT Act, Bharatiya Sakshya Adhiniyam 2023 (BSA), and IT Rules 2021 mandate preserving digital evidence and audit trails. Hard deletion of database records is strictly prohibited.

### Deactivation Workflow
```http
POST /api/onboarding/deactivate
Content-Type: application/json
Authorization: Bearer <org_owner_token>

{
  "reason": "Pilot trial successfully concluded; archiving custody records."
}
```

1. **Status Transition**: `organizations.status` transitions from `'active'` to `'deactivated'`.
2. **Access Revocation**: All active memberships are suspended; login and API access are blocked with HTTP 403.
3. **Evidence Integrity**: All cases, evidence locker items, SHA-256 hashes, and audit events remain permanently archived and available for legal discovery.
