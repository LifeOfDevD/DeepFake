# Indian Cyber Law & Statutory Compliance Framework

**Application:** Digital Impersonation Response Desk  
**Target Jurisdiction:** Republic of India  
**Applicable Statutes:**
* Information Technology Act, 2000 (IT Act)
* Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 (IT Rules 2021)
* Digital Personal Data Protection Act, 2023 (DPDP Act)
* Bharatiya Sakshya Adhiniyam, 2023 (BSA) / Indian Evidence Act, 1872 (IEA)

---

## 1. Statutory Substantive Offenses (IT Act, 2000)

The Response Desk's classification taxonomy maps technical impersonation signatures directly to offenses under the Information Technology Act, 2000:

| IT Act Section | Legal Description | Incident Mapping in Response Desk |
|---|---|---|
| **Section 66C** | Identity Theft (stealing or using unique electronic signature, password) | Compromised executive accounts, stolen corporate credentials |
| **Section 66D** | Cheating by Personation using computer resource | Fake executive social handles, spoofed customer care, synthetic fraud |
| **Section 66E** | Violation of Bodily Privacy (capturing/publishing private images without consent) | Deepfake videos, non-consensual synthetic visual alterations |
| **Section 43** | Penalty for unauthorized access, data extraction, or computer contamination | Malware links distributed via impersonating profiles |

---

## 2. Intermediary Due Diligence & SLAs (IT Rules 2021)

Social media intermediaries (Meta, Google, X, Telegram) owe statutory due diligence obligations under Rule 3 of the IT Rules 2021 to retain safe harbor protection under Section 79 of the IT Act:

### 2.1 Rule 3(2)(b): 72-Hour Impersonation Resolution SLA
* For complaints relating to impersonation, deepfakes, or fake accounts, the intermediary must take all reasonable and practicable measures to remove or disable access to the content **within 72 hours** of receiving the complaint.
* The Response Desk's **Statutory Clock Engine** initializes a strict 72-hour countdown immediately upon triage confirmation.

### 2.2 Rule 3(2): 24-Hour Acknowledgement SLA
* The intermediary must acknowledge receipt of the grievance **within 24 hours** and issue a unique grievance ticket.
* The platform tracks the 24-hour acknowledgement receipt and alerts operators if an intermediary fails to issue a ticket.

### 2.3 Rule 3(1)(h): 180-Day Mandatory Forensic Retention
* Intermediaries and incident investigation systems must preserve information and records relating to an incident for at least **180 days** following an investigation or grievance.
* The Response Desk implements S3 Object Lock in `COMPLIANCE` mode enforcing a default **180-day retention lock** on all forensic evidence.

### 2.4 Rule 3A: Grievance Appellate Committee (GAC) Appeals
* If an intermediary rejects a valid impersonation notice or fails to act within 72 hours, the complainant has the right to appeal to the central government's **Grievance Appellate Committee (GAC)** within **30 days**.
* The Response Desk automatically compiles a GAC-ready evidentiary dossier if a platform dispute is escalated.

---

## 3. Data Protection & Privacy (DPDP Act, 2023)

Operating an incident response desk requires processing personal data of both victims and alleged impersonators:

* **Forensic Retention vs. Right to Erasure (Section 12(3) vs Section 17(1)(c)):**
  While Section 12(3) grants Data Principals the right to erasure, **Section 17(1)(c)** provides a statutory exemption for processing necessary for enforcing any legal right or claim, or for the prevention, detection, or investigation of offences. This exemption shields the 180-day WORM retention policy.
* **Child Protection (Section 9):**
  If an impersonation incident targets a minor, verifiable parental consent (VPC) mechanisms are enforced before processing identification documents.
* **Cross-Border Transfers (Section 16):**
  Core evidence storage is strictly pinned to AWS `ap-south-1` (Mumbai, India). Dispatches to foreign platform grievance desks are handled through human-approved notices.

---

## 4. Admissibility of Electronic Records (Section 65B IEA / Section 63 BSA)

To ensure evidence captured by the Response Desk is admissible before Indian courts and law enforcement:
1. **Streaming SHA-256 Hashing:** Calculated directly from input stream at capture time.
2. **RFC 3161 Timestamps:** Synchronized against trusted NTP time sources.
3. **Automated Section 65B Certificate Generation:** Generates standardized evidentiary declarations attesting to device parameters, cryptographic hash, and custodial continuity.
