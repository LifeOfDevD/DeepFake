# LEG-001: Qualified Indian Legal Counsel Review Package

**Document ID:** LEG-001-BRIEF-v1.0  
**Target Jurisdiction:** Republic of India  
**Governing Statutes:**
* Information Technology Act, 2000 (IT Act) & Section 79 Intermediary Safe Harbor
* Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 (IT Rules 2021)
* Digital Personal Data Protection Act, 2023 (DPDP Act)
* Bharatiya Sakshya Adhiniyam, 2023 (BSA) / Indian Evidence Act, 1872 (Section 65B)
**Application:** Digital Impersonation Response Desk  
**Release Baseline:** `v1.0.0-controlled-pilot-rc2`  
**Current Assurance Status:** `OPEN / BRIEFING_PREPARED_AWAITING_COUNSEL_OPINION`  
**General Availability Gate:** Hard Blocker (GA strictly withheld until counsel delivers signed written opinion)  

---

## 1. Executive Summary

This briefing package formalizes the legal and regulatory assurance requirements for **LEG-001 (Qualified Indian Legal Counsel Review)**.

The **Digital Impersonation Response Desk** is an enterprise-grade platform engineered to detect, catalog, preserve evidence of, and formulate statutory takedown requests against online impersonation campaigns, fake social media accounts, scam domains, and executive brand infringement.

Because the system captures digital evidence, processes personal data of victims and suspected impersonators, and formulates formal statutory grievance notices under Indian law, unconstrained General Availability (GA) requires an authoritative legal opinion from a practicing Indian advocate / cyber law firm.

This package defines the 5 core statutory questions, provides the architectural and operational context, details evidence custody mechanisms, and sets the acceptance criteria for counsel's opinion.

---

## 2. The 5 Core Statutory Questions Submitted to Counsel

### Question 1: Statutory Retention (IT Rules 2021) vs. Right to Erasure (DPDP 2023)
* **Statutory Tension:**
  - **IT Rules 2021, Rule 3(1)(h):** Mandates that intermediaries and grievance systems preserve information, records, and evidence relating to an incident for at least **180 days** following an investigation or grievance.
  - **DPDP Act 2023, Section 12(3):** Grants Data Principals the right to erasure of their personal data upon withdrawal of consent or cessation of processing purpose.
* **Platform Architecture:** The platform implements S3 Object Lock in strict `COMPLIANCE` mode with a mandatory 180-day retention lock. Neither the application nor customer administrators can delete objects under legal hold during this window.
* **Specific Counsel Inquiry:**
  1. Does **Section 17(1)(c)** of the DPDP Act 2023 (exemption for processing necessary for enforcing any legal right or claim, or for prevention, detection, investigation of offences) provide absolute statutory immunity for maintaining the 180-day WORM retention over a Data Principal's erasure request?
  2. What is the legally defensible procedure when a complainant requests account deletion while an active impersonation investigation is locked under Rule 3(1)(h)?

---

### Question 2: Intermediary Safe Harbor & Liability Boundary (Section 79 IT Act)
* **Statutory Context:** Section 79 of the Information Technology Act provides conditional safe harbor to intermediaries that do not initiate transmission, select recipients, or modify content, and observe due diligence.
* **Platform Architecture:**
  - The Response Desk is **NOT an automated takedown dispatcher**.
  - All notices require explicit human review and multi-party cryptographic approval (`human_review_mandatory = 1`, `autonomous_takedown = 0`).
  - The platform operates as an authorized technological agent drafting notices on behalf of the verified victim or brand owner.
* **Specific Counsel Inquiry:**
  1. Does drafting and submitting formal takedown notices on behalf of enterprise victims expose the Response Desk operator to secondary liability or claims of tortious interference / defamation from alleged impersonators?
  2. Does the platform satisfy the due diligence requirements under Rule 3 of the IT Rules 2021 to preserve safe harbor immunity?

---

### Question 3: Cross-Border Data Transfers (Section 16 DPDP 2023)
* **Statutory Context:** Section 16 of the DPDP Act empowers the Central Government to restrict data transfers outside India to notified blacklisted countries or territories.
* **Platform Architecture:**
  - Primary data storage (evidence vault, audit ledger, case database) is strictly pinned to AWS `ap-south-1` (Mumbai, India).
  - However, takedown notifications must be transmitted to platform grievance officers located globally (e.g., Meta in Ireland/USA, Google in USA, Telegram in UAE, X Corp in USA).
* **Specific Counsel Inquiry:**
  1. Does the transmission of an impersonation notice (containing evidence screenshots, impersonating handles, and reporter contact info) to foreign platform grievance desks constitute a restricted cross-border personal data transfer?
  2. Under current DPDP provisions (pending negative-list notification), are standard contractual clauses (SCCs) or explicit consent waivers required from reporters prior to international notice dispatch?

---

### Question 4: Minor Protection Invariants (Section 9 DPDP 2023)
* **Statutory Context:** Section 9 of the DPDP Act mandates verifiable parental consent (VPC) before processing any personal data of a child (under 18 years), and strictly prohibits tracking, behavioral monitoring, or targeted advertising directed at children.
* **Platform Architecture:**
  - The platform is designed for enterprise B2B brand and executive protection.
  - However, impersonation campaigns may target child influencers, students, or dependants of corporate executives.
* **Specific Counsel Inquiry:**
  1. If an impersonation report involves a minor victim, what specific mechanism constitutes legally valid "verifiable parental consent" under Section 9 prior to processing the minor's identification documents?
  2. Does forensic monitoring of public impersonating accounts targeting a minor violate Section 9(3) prohibition against "tracking or behavioral monitoring"?

---

### Question 5: Grievance Appellate Committee (GAC) Timelines & Escalation (Rule 3A IT Rules 2021)
* **Statutory Context:**
  - Rule 3(2) requires intermediaries to acknowledge grievances within **24 hours** and resolve within **15 days** (or **72 hours** for impersonation/obscenity under Rule 3(2)(b)).
  - Rule 3A enables users aggrieved by intermediary decisions to appeal to the Grievance Appellate Committee (GAC) within **30 days**.
* **Platform Architecture:**
  - The platform enforces 24-hour acknowledgement and 36-hour/72-hour playbook SLAs.
  - It maintains a dedicated escalation workflow for rejected takedowns.
* **Specific Counsel Inquiry:**
  1. What evidentiary standards and formatting are required for direct filing of appeals before the GAC when an intermediary fails to act on a verified impersonation notice within 72 hours?
  2. Does the platform's automated timeline tracker and evidence dossier meet GAC procedural guidelines?

---

## 3. Admissibility of Electronic Records (Section 65B IEA / Section 63 BSA)

To ensure evidence captured by the Response Desk is admissible in Indian courts and before statutory law enforcement bodies:

* **Cryptographic Invariants Implemented:**
  1. **Streaming SHA-256:** Generated at capture time directly from input stream.
  2. **RFC 3161 Compliant Timestamps:** Embedded into evidence manifest with trusted clock synchronization.
  3. **Immutable Audit Ledger:** Append-only hash-chained transaction log with actor ID, organization context, and action details.
  4. **Certificate Generation:** The platform generates automated certificate templates for forensic evidence submission.

* **Counsel Action Required:**
  - Counsel must review and approve the **Section 65B / Section 63 BSA Electronic Certificate Generator** format to ensure complete evidentiary compliance for filing FIRs under Section 66D of the IT Act (Cheating by personation by using computer resource).

---

## 4. Counsel Review & Attestation Criteria

To close `LEG-001` and allow GA promotion, the following must be delivered:

1. **Formal Written Opinion:** Signed letterhead opinion from a qualified Indian advocate or law firm addressing all 5 statutory questions.
2. **Contractual Terms Approval:** Review and sign-off on the Master Services Agreement (MSA), Terms of Service, and Privacy Policy.
3. **Data Retention Hierarchy Endorsement:** Explicit confirmation that the 180-day WORM retention policy complies with Indian law.
4. **Certificate Template Validation:** Legal endorsement of the forensic certificate format for police/court filing.

---

## 5. Current Assurance Determination

* **Briefing Package State:** **`COMPLETE`** (All statutory questions, technical architectures, and legal constraints documented).
* **Counsel Engagement & Opinion:** **`PENDING`** (Awaiting formal written opinion from external legal counsel).
* **LEG-001 Status:** **`OPEN`**
* **Impact on GA Gate:** **`HARD_BLOCKER`** (General Availability remains strictly withheld).
