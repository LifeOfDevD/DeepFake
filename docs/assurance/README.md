# Assurance Governance & Production Promotion Portal

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Current Operating Posture:** Controlled Pilot / Production-Canary Only  
**General Availability (GA):** **`STRICTLY WITHHELD`**  

---

## 1. Assurance Governance Model

In our engineering discipline, a system is not certified for General Availability (GA) merely because unit and integration tests pass on a developer's workstation. 

For high-assurance incident response software touching enterprise brand reputation, digital forensics, and statutory grievance filings, production readiness requires **convergence of internal engineering excellence with external, independent evidence**.

```mermaid
graph TD
    subgraph Internal Software Baseline Verified
        A[80 Test Files / 447 Tests Passed]
        B[Clean TypeScript Compilation]
        C[SQLite WAL & Foreign Keys Integrity]
        D[Adversarial Security QA 11/11 Passed]
        E[Operator Golden Path 24/24 Steps Passed]
    end

    subgraph The 4 External Assurance Dependencies
        EXT[EXT-001: Independent Security Pentest]
        CLOUD[CLOUD-001: Production AWS ap-south-1 IaC]
        SOAK[SOAK-001: 72h Continuous Staged Canary]
        LEG[LEG-001: Indian Legal Counsel Opinion]
    end

    Internal Software Baseline Verified --> Gate{"Phase 12 GA Promotion Gate"}
    EXT -.->|Status: OPEN| Gate
    CLOUD -.->|Status: OPEN| Gate
    SOAK -.->|Status: BLOCKED| Gate
    LEG -.->|Status: OPEN| Gate
    Gate --> Decision["GENERAL AVAILABILITY: STRICTLY WITHHELD"]
```

---

## 2. Assurance Documentation Directory

* **[Current Assurance Status](current-status.md):** Detailed breakdown of the four external assurance activities, current blocker statuses, risk assessments, and prerequisites.
* **External Assurance Packages:**
  - [`EXT-001 Scope Package`](../external-assurance/EXT-001_SCOPE.md): Formal pen-testing scope and rules of engagement.
  - [`CLOUD-001 Infrastructure Assurance`](../external-assurance/CLOUD-001_ASSURANCE.md): AWS `ap-south-1` KMS CMK and S3 Object Lock review.
  - [`SOAK-001 Canary Observation Plan`](../external-assurance/SOAK-001_CANARY_PLAN.md): 72-hour staged soak testing protocol.
  - [`LEG-001 Legal Counsel Package`](../external-assurance/LEG-001_COUNSEL_PACKAGE.md): 5 statutory questions under IT Rules 2021 & DPDP Act 2023.
