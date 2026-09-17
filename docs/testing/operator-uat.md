# Operator User Acceptance Testing (UAT): 24-Step Golden Path

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Test Protocol:** 24-Step Multi-Persona Golden Path  
**Overall UAT Verdict:** **PASS (24 / 24 Steps Verified)**  

---

## 1. UAT Execution Summary

The Operator UAT suite evaluates the end-to-end user experience of the Digital Impersonation Response Desk from the perspective of four distinct enterprise operational personas:
1. **Priya Nair (`CaseManager`):** Overall incident coordinator.
2. **Dr. Vikram Rao (`OrgAdmin` / Victim):** Corporate executive whose identity was impersonated.
3. **Ananya Deshmukh (`LegalCounsel`):** Compliance and legal reviewer.
4. **Rohan Verma (`EvidenceSpecialist`):** Forensic custody and technical reviewer.

---

## 2. The 24-Step Operator Golden Path Matrix

| Step | Persona | Operational Action | Expected Result | Status |
|---|---|---|---|---|
| **01** | CaseManager | Authenticate / Session Initialization | Login successful; session token issued; dashboard renders | **PASS** |
| **02** | CaseManager | Set Active Organization Context | Organization context locked to `Apex Health Systems` (`org_apex_health_01`) | **PASS** |
| **03** | CaseManager | Inspect Incident Dashboard | KPI cards initialize: Active Cases, Ingested Signals, SLA Clocks | **PASS** |
| **04** | CaseManager | Create New Incident Case | Case created: "Synthetic Video - Deepfake Endorsement of Unauthorized Drug" | **PASS** |
| **05** | CaseManager | Transition Case to Triage | Case status moves from `intake` to `triage` | **PASS** |
| **06** | CaseManager | Triage Threat Classification | Mapped to IT Act Sec 66D & IT Rules 3(2)(b); 72h countdown initialized | **PASS** |
| **07** | EvidenceSpecialist | Switch Actor to Evidence Specialist | Active role badge updates to `EvidenceSpecialist` | **PASS** |
| **08** | EvidenceSpecialist | Upload Evidence Artifact | Uploads synthetic screenshot; streaming SHA-256 computed on wire | **PASS** |
| **09** | EvidenceSpecialist | Inspect Custody Metadata | SHA-256 bound to evidence ID; magic-byte format confirmed (`image/png`) | **PASS** |
| **10** | EvidenceSpecialist | Generate HMAC Download Token | 300s time-limited download token issued; file retrieved and verified | **PASS** |
| **11** | EvidenceSpecialist | Apply Legal Hold | Evidence locked; attempted deletion returns `HTTP 409 Conflict` | **PASS** |
| **12** | Analyst | Ingest External Signal | Raw impersonation URL ingested into monitoring queue | **PASS** |
| **13** | Analyst | Review & Score Candidate Signal | Risk score calculated; candidate promoted to confirmed threat | **PASS** |
| **14** | Analyst | Link Signal to Incident Case | Signal attached to the active deepfake case | **PASS** |
| **15** | LegalCounsel | Switch Actor to Legal Counsel | Active role badge updates to `LegalCounsel` | **PASS** |
| **16** | LegalCounsel | Select Platform & Playbook | Selects YouTube Impersonation / Deepfake Grievance Playbook | **PASS** |
| **17** | LegalCounsel | Formulate Notice Packet Draft | Statutory grievance draft compiled with statutory citations | **PASS** |
| **18** | LegalCounsel | Execute Facet 1 Approval (Legal) | Legal sign-off committed with timestamp to `submission_approvals` | **PASS** |
| **19** | EvidenceSpecialist | Execute Facet 2 Approval (Evidence) | Evidence Specialist signs off on screenshot authenticity and hash | **PASS** |
| **20** | CaseManager | Execute Final Operational Sign-Off | Case Manager confirms multi-facet approvals and triggers dispatch | **PASS** |
| **21** | System | Dry-Run Simulation Dispatch | Submission moves to `simulated_submitted`; zero outbound network calls | **PASS** |
| **22** | CaseManager | Safety Check: 0 Outbound Dispatches | Verifies outbound dispatch log contains 0 requests (Controlled Pilot) | **PASS** |
| **23** | CaseManager | Audit Ledger Inspection | Complete chronological event log verified; actor IDs and timestamps bound | **PASS** |
| **24** | CaseManager | Session Termination / Logout | Session revoked; local token cleared; redirected to login view | **PASS** |

---

## 3. Reference Artifacts

* Full Operator UAT Report: [`docs/OPERATOR_UAT_REPORT.md`](../OPERATOR_UAT_REPORT.md).
* Machine-Readable UAT Execution Results: [`results/phase-11c-uat-results.json`](../../results/phase-11c-uat-results.json).
