# Phase 3 Architecture: Controlled Intake, Triage, Statutory Clocks & Submission Preparation

## 1. Architectural Philosophy & Safety Boundaries

The **Digital Impersonation Response Desk** is built specifically for the Indian regulatory landscape to empower healthcare professionals, public figures, brands, and agencies to counter digital impersonation, voice clones, and synthetic media.

### 1.1 Core Safety Invariants
1. **Strictly DRY-RUN / Simulated Submissions**: The system never communicates directly with external platform takedown APIs or dispatches unreviewed takedowns over the network. Platform submissions are executed in simulated dry-run mode, producing signed, cryptographically hashed Section 79 notice packets and evidence manifests for human operator execution.
2. **Deterministic Triage**: All incident classification, statutory routing, and severity scoring are strictly rule-based and auditable. There are no opaque LLM inferences or hallucination-prone black-box decisions in legal classification.
3. **Separation of Duties**: No operator can unilaterally request legal review and subsequently self-approve it. An independent legal reviewer or organization owner is strictly required.
4. **Zero External Network Scraping**: No automated HTTP fetches or scraping of contested URLs occurs within the application boundaries, avoiding IP contamination, SSRF risks, or terms-of-service violations.

---

## 2. India-First Statutory & Regulatory Framework

The platform maps directly to Indian statutory enactments and regulatory rules governing intermediaries, synthetic media, and cyber offenses:

```mermaid
graph TD
  A[Contested Incident Intake] --> B{Intimate Imagery / Nudity?}
  B -- Yes --> C[IT Rules 2021 Rule 3(2)(b)<br/>Expedited 24-Hour Removal Clock]
  B -- No --> D{Court Order / Govt Notice?}
  D -- Yes --> E[IT Rules 2021 Rule 3(1)(b)<br/>Mandatory 72-Hour Removal Clock]
  D -- No --> F{Harm & Impersonation Matrix}
  F --> G[IT Act Sec 66C / 66D / 79<br/>BNS 2023 Sec 318(4) / 356<br/>Intermediary Grievance Route]
  
  C --> H[14-Point Readiness Engine]
  E --> H
  G --> H
  H --> I[Separation-of-Duties Legal Review]
  I --> J[Cryptographic Submission Packet]
  J --> K[Simulated Platform Submission]
```

### 2.1 Information Technology Act, 2000
- **Section 66C**: Identity theft involving digital signatures, passwords, or unique identification features (e.g. biometric voice/face clones).
- **Section 66D**: Cheating by personation using computer resources.
- **Section 66E**: Violation of bodily privacy by capturing, publishing, or transmitting images of private areas without consent.
- **Section 79**: Safe harbor exemption for intermediaries conditional upon expeditious takedown upon receiving "actual knowledge" (as interpreted in *Shreya Singhal v. Union of India*).

### 2.2 Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021
- **Rule 3(1)(b)**: Mandates intermediary due diligence to not host content that impersonates another person, deceives or misleads the addressee, or infringes intellectual property. Requires removal within **72 hours** upon receipt of court order or government notification.
- **Rule 3(2)(a)**: Grievance Officer must acknowledge complaints within **24 hours** and dispose of them within **15 days**.
- **Rule 3(2)(b)**: **Expedited 24-Hour Window**: Intermediaries must remove or disable access to content exposing private areas or showing individuals in partial/full nudity or impersonating their likeness in an intimate manner within **24 hours** of complaint receipt.
- **Rule 3A**: Right to appeal to the Grievance Appellate Committee (GAC) within **30 days** of Grievance Officer decision, with GAC resolution within **15 days**.

### 2.3 Bharatiya Nyaya Sanhita (BNS), 2023
- **Section 318(4)**: Cheating by personation (carrying imprisonment up to five years).
- **Section 356**: Defamation and intentional injury to reputation.

---

## 3. Statutory Clock Tracking Engine (`Asia/Kolkata`)

All statutory countdowns and compliance windows operate strictly in **Indian Standard Time (IST, `Asia/Kolkata`, UTC+05:30)**.

### 3.1 Clock Types & Windows
| Clock Type | Legal Source | Default Window | Trigger Event |
| :--- | :--- | :--- | :--- |
| `it_rules_2021_24h_intimate` | IT Rules Rule 3(2)(b) | 24 Hours | Incident intake flagged with intimate imagery or likeness theft. |
| `it_rules_2021_72h_standard` | IT Rules Rule 3(1)(b) | 72 Hours | Court order or formal government notice registered. |
| `grievance_ack_24h` | IT Rules Rule 3(2)(a) | 24 Hours | Grievance notice dispatched to platform officer. |
| `grievance_resolve_15d` | IT Rules Rule 3(2)(a) | 15 Days | Grievance acknowledged by intermediary. |
| `gac_appeal_30d` | IT Rules Rule 3A | 30 Days | Adverse or non-responsive intermediary disposition. |

### 3.2 Dynamic Status & Alert Thresholds
Clock countdowns are recalculated dynamically upon every query:
- `running`: Remaining hours > 24 hours.
- `due_soon`: Remaining hours ≤ 24 hours and > 6 hours.
- `urgent`: Remaining hours ≤ 6 hours and > 0 hours.
- `overdue`: Remaining hours < 0 hours (statutory deadline passed).
- `stopped`: Notice formally acknowledged or case disposed.
- `paused`: Case placed under administrative stay or court adjournment.

---

## 4. Deterministic Triage Matrix

The triage engine evaluates incident properties deterministically:

1. **Intimate Imagery Check**: If `is_intimate_imagery = true` or `harm_type = 'intimate_imagery_threat'`, route is designated `rule_3_2_b_intimate_expedited`, severity is set to `critical`, statutory clock is initialized to 24h, and legal review is mandated.
2. **Court Order / Government Directive**: If `court_order_available = true` or `court_order_details` is provided, route is designated `rule_3_1_b_court_order_72h`, severity is set to `high` or `critical`, and 72h clock is initialized.
3. **Medical & Financial Deception**: If `harm_type` in `['financial_fraud', 'medical_misinformation', 'extortion']`, route is designated `bns_cheating_personation`, severity is elevated to `high` or `critical`, invoking IT Act 66D and BNS 318(4).
4. **Reputational Defamation**: If `harm_type = 'reputational_defamation'`, requires `defamation_factual_basis` and invokes BNS Section 356 alongside Section 79 Intermediary notice.

---

## 5. 14-Point Case Readiness Engine

Before any case can transition to `ready_for_submission`, it must satisfy a 14-point deterministic checklist:

| # | Checklist ID | Rule Description | Severity |
| :- | :--- | :--- | :--- |
| 1 | `VALID_CONTESTED_URL` | Contested URL is syntactically valid and non-empty. | Blocking |
| 2 | `HOSTING_PLATFORM_IDENTIFIED` | Platform recognized (`instagram`, `youtube`, `x`, `meta`, `linkedin`, `telegram`, `generic_web`). | Blocking |
| 3 | `TARGET_ENTITY_SPECIFIED` | Target victim name or entity specified. | Blocking |
| 4 | `TARGET_ENTITY_TYPE_SPECIFIED` | Entity categorized (`doctor_healthcare`, `creator_individual`, `brand_enterprise`, `agency_talent`, `executive`). | Blocking |
| 5 | `SYNTHETIC_MEDIA_TYPE_SPECIFIED` | Media classification assigned (`video_deepfake`, `voice_clone`, `fabricated_document`, `profile_impersonation`). | Blocking |
| 6 | `IMPERSONATION_METHOD_SPECIFIED` | Method classified (`likeness_theft`, `voice_synthesis`, `trademark_counterfeit`, `credential_fraud`). | Blocking |
| 7 | `HARM_TYPE_SPECIFIED` | Concrete harm identified (`financial_fraud`, `medical_misinformation`, `reputational_defamation`, `intimate_imagery_threat`). | Blocking |
| 8 | `TRIAGE_CLASSIFICATION_PERFORMED`| Deterministic triage record evaluated and saved. | Blocking |
| 9 | `EVIDENCE_ARTIFACT_PRESERVED` | At least one active (non-deleted) evidence item attached. | Blocking |
| 10 | `EVIDENCE_HASH_VERIFIED` | All evidence items possess cryptographic SHA-256 digests. | Blocking |
| 11 | `NO_ACTIVE_DELETION_REQUESTS` | No attached evidence is under pending two-person deletion. | Blocking |
| 12 | `STATUTORY_CLOCK_RUNNING` | An applicable statutory clock is initialized. | Non-blocking (Advisory) |
| 13 | `LEGAL_REVIEW_SATISFIED` | Legal review approved if required by triage severity. | Blocking |
| 14 | `FACTUAL_BASIS_PROVIDED` | Specific factual basis or court order details provided. | Blocking |

---

## 6. Approval State Machine & Separation of Duties

The approval lifecycle manages transition gates with strict RBAC:

```
[draft] ──(analyst/mgr)──> [triage_complete] ──(analyst/mgr)──> [awaiting_legal_review]
                                                                        │
                                                            (legal_reviewer / owner)
                                                              [Dual-Authorization]
                                                                        │
                                                                        ▼
[submission_simulated] <──(mgr/owner)── [ready_for_submission] <── [legal_review_approved]
```

### Separation of Duties Constraint
To eliminate conflict of interest and inadvertent submission:
- An operator (e.g. Analyst or Case Manager) who requests legal review (`awaiting_legal_review`) is recorded as `requester_user_id`.
- The subsequent transition to `legal_review_approved` **strictly prohibits** `actor_user_id === requester_user_id`.
- Attempted self-approval returns `403 SEPARATION_OF_DUTIES_VIOLATION`.

---

## 7. Submission Packet & Simulation Architecture

The generated submission packet is a self-contained, canonical record:
1. **Structured Canonical JSON**: Case metadata, statutory legal bases, platform intermediary address, target identification, and cryptographic evidence manifest.
2. **Section 79 Notice (Markdown)**: A legally structured grievance notice citing Rule 3 of the IT Rules 2021, specifying exact contested URLs, providing proof of authorization, and detailing legal repercussions.
3. **Evidence Manifest**: Table of filenames, SHA-256 digests, MIME types, capture timestamps, and custody ledger references.
4. **Packet SHA-256 Hash**: The entire packet payload is normalized and hashed with SHA-256 for evidentiary integrity.
5. **Simulation Dispatch**: Calling `POST /api/cases/:id/simulate-submission` marks the packet `simulated`, transitions approval to `submission_simulated`, and records an immutable audit log entry.
