# Incident Quarantine and Statutory Content Exclusion Protocol

## 1. Excluded Matter Policy
The **Digital Impersonation Response Desk** is an enterprise grievance and incident workflow platform designed for impersonation, synthetic likeness abuse, scam ads, brand infringement, and defamation.

The platform explicitly **excludes** commercial handling of:
1. Child Sexual Abuse Material (CSAM) / Child Sexual Exploitation and Abuse (CSAE) (Protection of Children from Sexual Offences [POCSO] Act 2012, IT Act 2000 Section 67B).
2. Non-Consensual Intimate Imagery (NCII) / Sexual Extortion / Morphing of an explicit sexual nature (IT Act 2000 Section 66E, 67, 67A; BNS 2023 Section 77).
3. Severe graphic violence, terrorism, or bodily harm inciting immediate public danger.

---

## 2. Automated Safety & Quarantine Protocol

When evidence or a case is identified as falling under excluded categories:

### 2.1 State Transitions
- Case status is immediately updated to `blocked` (Quarantined).
- Evidence sensitivity is set to `prohibited` and evidence status to `quarantined`.

### 2.2 Strict Preview Suppression
- **Zero Raw Rendering**: In the web UI and API responses, image thumbnails, media players, and raw content streams are completely suppressed.
- **Replacement Safety Banner**: The UI displays a persistent safety alert:
  > **CRITICAL SAFETY PROTOCOL: Quarantined Excluded Incident**
  > This content falls outside commercial response desk scope. All standard ingestion and previews are suspended. Report immediately to the National Cyber Crime Reporting Portal at [cybercrime.gov.in](https://cybercrime.gov.in) or dial **1930**.

### 2.3 Access Restriction
- Ordinary Analysts and Stakeholders are strictly blocked (HTTP 403 Forbidden) from downloading or viewing quarantined assets.
- Access is restricted exclusively to authorized Legal Counsel (`legal_reviewer`) and Organization Owners (`org_owner`) solely for official statutory transmission to law enforcement authorities.

---

## 3. Statutory Referral Channels
All quarantined matters must be directed to designated Indian government channels:
- **National Cyber Crime Reporting Portal (NCRP)**: [https://cybercrime.gov.in](https://cybercrime.gov.in)
- **National Cyber Crime Helpline**: Dial `1930` (Toll-Free, 24x7)
- **Emergency Police Response**: Dial `112`
