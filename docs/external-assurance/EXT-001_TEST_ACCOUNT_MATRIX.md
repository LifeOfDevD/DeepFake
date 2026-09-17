# EXT-001: Test Account & Multi-Tenant Authorization Matrix

**Target Application:** Digital Impersonation Response Desk  
**Target Release:** `v1.0.0-controlled-pilot-rc2`  
**Date:** 2026-09-16  

---

## 1. Test Persona Credentials

All test personas are pre-seeded in the staging database (`data/response_desk_staging.sqlite`). The test password for all staging personas is: `pbkdf2_mock_hash_for_testing`.

| User ID | Email Address | System Role | Organization Membership | Org Role | Intended Testing Purpose |
|---|---|---|---|---|---|
| `usr_sysadmin_00` | `sysadmin@desk.example` | `system_admin` | Global / Cross-Org | Administrator | Global emergency kill-switch toggle, cross-org administrative actions |
| `usr_apex_owner_01` | `dr.verma@apexhealth.example` | `user` | `org_apex_health_01` | `org_owner` | Second-person deletion approval, executive consent, billing review |
| `usr_apex_mgr_02` | `priya.nair@apexhealth.example` | `user` | `org_apex_health_01` | `case_manager` | Incident intake, case lifecycle, evidence upload, deletion request |
| `usr_apex_analyst_03` | `rohit.sen@apexhealth.example` | `user` | `org_apex_health_01` | `analyst` | Signal review, candidate triage, note creation |
| `usr_apex_legal_04` | `adv.menon@apexhealth.example` | `user` | `org_apex_health_01` | `legal_reviewer` | Placing/releasing statutory legal holds, takedown notice approval |
| `usr_apex_client_05` | `stakeholder@apexhealth.example` | `user` | `org_apex_health_01` | `read_only_stakeholder` | Read-only inspection; test privilege escalation by attempting writes |
| `usr_bharatfin_mgr_06` | `vikram.seth@bharatfin.example` | `user` | `org_bharatfin_02` | `case_manager` | **TENANT B CASE MANAGER**: Target for horizontal IDOR / cross-tenant attacks |

---

## 2. Pre-Seeded Resource Identifiers for IDOR Testing

The assessor should use these seeded resource IDs to attempt cross-tenant read, write, and disposal operations:

### 2.1 Organization A (`org_apex_health_01`) Resources
- **Cases:**
  - `case_apex_2026_001` (Status: `evidence_collection`, Priority: `high`)
  - `case_apex_2026_002` (Status: `triage`, Priority: `medium`)
- **Evidence:**
  - `ev_apex_001` (Screenshot of synthetic impersonator, SHA-256 verified)
  - `ev_apex_002` (Source URL record of contested advertisement)
- **Monitored Subjects:**
  - `sbj_apex_001` (`Dr. Anand K. Verma, CMO`, Executive profile)

### 2.2 Organization B (`org_bharatfin_02`) Resources (Target for Tenant Isolation Probing)
- **Cases:**
  - `case_bharatfin_2026_003` (Status: `evidence_collection`, Priority: `critical`)
- **Evidence:**
  - `ev_bharatfin_003` (Confidential financial executive impersonation screenshot)
- **Monitored Subjects:**
  - `sbj_bharatfin_001` (`Vikram Seth, Managing Director`)

---

## 3. Role-Based Permissions Matrix (Expected Enforcement)

| Operation / Endpoint | `read_only_stakeholder` | `analyst` | `case_manager` | `legal_reviewer` | `org_owner` | `system_admin` |
|---|---|---|---|---|---|---|
| View Cases (`GET /api/cases`) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Create Case (`POST /api/cases`) | **DENY (403)** | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Transition Case Status (`PATCH /api/cases/:id/status`) | **DENY (403)** | **DENY (403)** | ALLOW | ALLOW | ALLOW | ALLOW |
| Upload Evidence (`POST /api/cases/:id/evidence`) | **DENY (403)** | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Place Legal Hold (`POST /api/evidence/:id/legal-hold`) | **DENY (403)** | **DENY (403)** | ALLOW | ALLOW | ALLOW | ALLOW |
| Release Legal Hold (`DELETE /api/evidence/:id/legal-hold`) | **DENY (403)** | **DENY (403)** | **DENY (403)** | ALLOW | ALLOW | ALLOW |
| Request Deletion (`POST /api/evidence/:id/deletion-request`) | **DENY (403)** | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Approve Deletion (`POST /api/evidence/:id/approve-deletion`) | **DENY (403)** | **DENY (403)** | ALLOW* | ALLOW* | ALLOW* | ALLOW* |
| Toggle Kill-Switch (`POST /api/integrations/kill-switch`) | **DENY (403)** | **DENY (403)** | **DENY (403)** | **DENY (403)** | ALLOW | ALLOW |

*\*Note: Approver must be a different persona than the requester (Two-Person rule enforced regardless of role).*
