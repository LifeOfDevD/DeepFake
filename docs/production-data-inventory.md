# Production Data Inventory, Classification & DPDP Act (2023) Assessment

**Document Version:** 1.0.0  
**Status:** DRAFT PRIVACY ASSESSMENT (SUBJECT TO QUALIFIED LEGAL REVIEW)  
**Target Architecture:** Digital Impersonation Response Desk (Staging / Production Canary)  
**Applicable Frameworks:** Digital Personal Data Protection Act, 2023 (DPDP Act); Information Technology Act, 2000; Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.  

---

## 1. Executive Summary & Purpose

The **Digital Impersonation Response Desk** processes digital evidence, personal identity records, contested uniform resource locators (URLs), and incident workflows on behalf of organizational subscribers (enterprises, healthcare providers, universities, executive offices, public figures) seeking rapid redressal against online impersonation and synthetic-media abuse.

This document inventories the **12 fundamental data classes** processed by the system, records their sensitivity classification, encryption controls, tenant isolation guarantees, retention periods, and deletion mechanisms, and provides an actionable DPDP Act 2023 compliance assessment highlighting areas requiring independent qualified legal counsel review.

---

## 2. Comprehensive Data Classification Matrix

| # | Data Class | Primary Entities / Tables | Data Elements Included | Sensitivity | Encryption (Rest / Transit) | Retention Period | Deletion / Shredding Mechanism | Tenant Boundary |
|---|---|---|---|---|---|---|---|---|
| **1** | **User & Authentication Records** | `users`, `sessions`, `account_lockouts` | Name, email address, password hash (bcrypt), role, active status, failed attempt counts, lockout expiry. | Confidential / PII | Rest: DB encryption / bcrypt.<br>Transit: TLS 1.3. | Active account duration + 30 days post-termination. | Hard DB deletion upon account closure; memory-cleared upon lockout lapse. | Scoped to `organization_id` (except global root admin). |
| **2** | **Tenant & Organization Profiles** | `organizations`, `entitlements` | Organization legal name, slug, domain whitelist, subscription tier, pilot flags, rate quotas. | Internal / Commercial | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Lifetime of subscription contract + statutory commercial retention (3 years). | Soft-tombstone then DB purge after legal retention hold expires. | Root isolation key (`organization_id`). |
| **3** | **Case Incident Master Records** | `cases` | Case number, incident title, victim entity, contested URL, platform name, case status, priority, assigned analyst. | Confidential / Sensitive | Rest: AES-256-GCM / DB storage.<br>Transit: TLS 1.3. | Active investigation + default 180 days (configurable up to 730 days). | Two-person authorization deletion workflow; blocked if active legal hold exists. | Hard filtered: `WHERE organization_id = ?`. |
| **4** | **Evidence Binary Payloads** | Storage objects (`.bin`), `evidence_items` | Impersonating video clips, synthetic audio recordings, profile screenshots, phishing HTML dumps. | Highly Confidential / SPII | Rest: AWS KMS / S3-managed AES-256; opaque UUID storage paths.<br>Transit: TLS 1.3. | Default 180 days; indefinitely during active legal hold. | Storage object unlinked + crypto-shredding via KMS key deletion/zeroing. | Path prefix: `${orgId}/${year}/${month}/${day}/${uuid}.bin`. |
| **5** | **Evidence Cryptographic Metadata & Chain of Custody** | `evidence_items`, `evidence_custody_events` | SHA-256 hash, magic-byte detected MIME, byte size, uploader ID, verification timestamp, custody log. | Confidential / Evidentiary | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Preserved with parent evidence; audit custody retained 365 days. | Linked to evidence deletion; audit trail archived with anonymized subject ref. | Enforced by `organization_id`. |
| **6** | **Legal Holds & Preservation Notices** | `legal_holds` | Preservation notice ref, issuing legal entity, reason, hold creator ID, active flag, created timestamp. | Strictly Confidential | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Active until explicit documented legal release by Organization Legal Admin. | Update `active = 0` followed by audited retention evaluation. | Strict tenant isolation. |
| **7** | **Platform Playbooks & Grievance Submissions** | `platform_playbooks`, `submissions` | Platform Grievance Officer details, submission packet metadata, tracking ticket IDs, compliance status. | Internal / Legal | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Case lifetime + 180 days. | Hard deleted with parent case; submission logs retained in audit. | Enforced by `organization_id`. |
| **8** | **Escalation & Grievance Notices** | `escalations` | Form 1 notices, Rule 3(2)(b) statutory notice text, intermediary delivery receipts, response status. | Confidential / Legal | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Case lifetime + 180 days. | Deleted upon case purge. | Strict tenant isolation. |
| **9** | **Synthetic Media Detection Telemetry** | `detection_telemetry` | Detection confidence scores, model vendor metadata, audio frequency anomalies, facial artifact metrics. | Internal / Forensic | Rest: DB volume encryption.<br>Transit: TLS 1.3. | Case lifetime + 180 days. | Purged on case deletion. | Scoped to case and tenant. |
| **10** | **External Provider Integration State** | `provider_connections`, `provider_sync_state` | Provider name (e.g. YouTube Data API v3), client ID, encrypted OAuth access/refresh tokens, webhook secrets, sync cursors. | Highly Confidential / Secrets | Rest: Field-level AES-256-GCM (`desk_enc_v1`) via SecretsManager.<br>Transit: TLS 1.3. | Connection lifetime; discarded immediately upon disconnect. | Master key rotation or immediate zeroization of ciphertext and salts. | Isolated by `organization_id` and unique connection ID. |
| **11** | **Monitoring Signals & Candidate Reviews** | `monitoring_signals`, `candidate_reviews` | External channel IDs, contested video IDs, public profile URLs, similarity match rationale, triage notes. | Confidential | Rest: DB volume encryption.<br>Transit: TLS 1.3. | 90 days if unconfirmed candidate; linked to case if confirmed. | Automated worker prune of unconfirmed candidates after 90 days. | Enforced by `organization_id`. |
| **12** | **Tamper-Evident Immutable Audit Log** | `audit_events` | Monotonic sequential ID, actor ID, client IP, action verb, resource ID, before/after diff hash, SHA-256 tamper-evident chain hash. | Confidential / Audit | Rest: Cryptographically chained hashes in DB.<br>Transit: TLS 1.3. | Mandatory 365-day retention (IT Rules 2021 compliance). | Append-only. No deletion allowed until statutory 365-day rollover. | Tenant filter + system-wide security log views for compliance officers. |

---

## 3. Privacy-by-Design Architecture & Data Minimization

1. **Human-Review Gate (Zero Autonomous Accusation):**  
   The platform never generates automated public takedowns or files unreviewed criminal complaints. All candidate impersonation matches require mandatory human review (`human_review_mandatory: 1`), preventing algorithmic misidentification of lawful speech.

2. **Opaque Storage Layout:**  
   Evidence binaries are stored without sensitive original filenames, case numbers, or victim identifiers in their storage keys:
   `${orgId}/${YYYY}/${MM}/${DD}/${randomUUID}.bin`
   Access is granted exclusively through short-lived (15-minute), HMAC-SHA256 pre-signed URLs with download rate limiting (30 requests/minute).

3. **Multi-Tenant Logical Isolation:**  
   Every query across cases, evidence, playbooks, submissions, and provider connections strictly validates `organization_id` from the authenticated session context. Cross-tenant access attempts immediately trigger security audit alerts and HTTP 403 Forbidden responses.

4. **Secret-Splitting & Cryptographic Shredding:**  
   External provider integration credentials and sensitive tokens are encrypted using AES-256-GCM with PBKDF2 (100,000 iterations). Decommissioning a tenant or integration triggers cryptographic shredding: clearing the encryption keys renders stored ciphertext mathematically irrecoverable.

---

## 4. Digital Personal Data Protection (DPDP) Act, 2023 Analysis

### 4.1 Fiduciary vs. Processor Role
- **Tenant Subscriber as Data Fiduciary:** The enterprise or institutional subscriber determines the purpose and means of identifying impersonation incidents and collecting evidence.
- **Response Desk as Data Processor:** The application processes data solely on behalf of and per the instructions of the subscribing organization under an enterprise service agreement.

### 4.2 Lawful Grounds for Processing (Section 4 & Section 7)
- Processing of impersonating URLs and publicly posted synthetic media is justified under legitimate uses:
  - **Section 7(c):** For compliance with any judgment or order issued under any law in India.
  - **Section 7(e):** For responding to a medical or health emergency, or breakdown of public order (critical for healthcare impersonation or financial fraud).
  - **Section 7(g):** For reasonable purposes specified by regulations, including cybersecurity incident response, fraud prevention, and network security.

### 4.3 Data Principal Rights Handling
- **Right to Access & Correction (Section 11 & 12):** Tenant admins can query, export, and correct case records and victim profile associations.
- **Right to Erasure (Section 12(3)):** Built-in two-person deletion workflow allows timely deletion upon resolution of the impersonation incident, subject to statutory preservation obligations.

---

## 5. Specific Items Requiring Qualified Indian Legal Counsel Review

> [!IMPORTANT]
> The following matters involve evolving statutory interpretations and regulatory rule-making under the DPDP Act 2023 and the Information Technology Act 2000. They MUST be formally reviewed and certified by qualified Indian legal counsel prior to full commercial production launch:

1. **Interplay Between IT Rules 2021 Retention and DPDP Erasure Requests:**  
   Rule 3(1)(h) of the IT (Intermediary Guidelines) Rules 2021 requires preserving information for 180 days after cancellation or withdrawal of registration, and 365 days for cyber incident records. Qualified legal counsel must review the interaction between a Data Principal's DPDP erasure request (under Section 12) and statutory preservation mandates under IT Rules 2021.

2. **Cross-Border Transfer Restrictions (Section 16, DPDP Act):**  
   If managed cloud object storage (e.g., AWS S3) utilizes regions outside India or if foreign platform integrations (e.g. YouTube API, Meta Graph API) transmit incident data to servers outside India, legal counsel must review compliance with Central Government blacklists/whitelists and cross-border data transfer rules once notified.

3. **Processing of Personal Data of Children (Section 9, DPDP Act):**  
   If the Response Desk is deployed for educational institutions (schools, universities) where impersonated victims or reported accounts involve individuals under 18 years of age, Section 9 mandates verifiable parental consent and prohibits behavioral tracking. Counsel must review onboarding workflows and age-gating requirements for educational tenants.

4. **Intermediary Safe Harbor Protections (Section 79, IT Act 2000):**  
   The Desk assists subscribers in preparing grievance notices to Significant Social Media Intermediaries (SSMIs) under Rule 3(2)(b). Legal counsel must certify that providing templated statutory notices does not expose the Response Desk itself to intermediary liability or third-party defamation claims.

5. **Grievance Redressal Mechanism & Appellate Timelines:**  
   Form 1 notices stipulate a 72-hour acknowledgment and resolution window, and a 24-hour window for Rule 3(2)(b) non-consensual sexually explicit content. Counsel must confirm that the platform's SLA tracking and automated reminder intervals adhere to the latest Ministry of Electronics and Information Technology (MeitY) and Grievance Appellate Committee (GAC) directives.
