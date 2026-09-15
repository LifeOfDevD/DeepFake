# ADR 0002: India-First Statutory Framework and Platform Escalation Taxonomy

## Context
Online impersonation, synthetic media scams, and deepfakes targeting Indian doctors, business founders, and creators are subject to specific statutory frameworks, intermediary liability regulations, and grievance mechanisms in India. Generic international notice-and-takedown templates (e.g. US DMCA 512) are insufficient and often ignored when addressing non-copyright impersonation or deepfakes on platforms operating in India.

## Decision
The platform adopts an explicit India-first legal and operational taxonomy:
1. **Statutory Grounding**:
   - **IT Act 2000, Section 66C**: Identity theft (electronic signature, password, distinctive biometric/voice feature).
   - **IT Act 2000, Section 66D**: Cheating by personation through computer resource.
   - **IT Act 2000, Section 66E**: Violation of bodily privacy and unauthorized likeness capture.
   - **IT Rules 2021, Rule 3(1)(b)**: Intermediary obligation to prohibit impersonation and deceptive synthetic content.
   - **IT Rules 2021, Rule 3(2)(b)**: Statutory 24-hour grievance takedown obligation for impersonation / nudity / likeness violations upon receipt of complaint; 72-hour window for other unlawful content.
   - **Bharatiya Nyaya Sanhita (BNS) 2023**: Sections 318, 319 (Cheating by Personation), Section 336 (Forgery for reputation damage), Section 356 (Defamation).
   - **Copyright Act 1957 & Trade Marks Act 1999**: Direct infringement and passing-off claims.
2. **Platform Escalation Hierarchy**:
   - Level 1: Standard In-App Intermediary Abuse Reporting (Form submission / API).
   - Level 2: Intermediary Resident Grievance Officer (RGO) Statutory Grievance under IT Rules 2021.
   - Level 3: Grievance Appellate Committee (GAC - `gac.gov.in`) statutory appeal against intermediary non-action.
   - Level 4: Law Enforcement escalation via National Cyber Crime Reporting Portal (NCRP - `cybercrime.gov.in`) or National Cyber Helpline `1930`.

## Consequences
- **Positive**: Notices drafted by the system are grounded in enforceable Indian law, resulting in significantly higher response rates from Indian Resident Grievance Officers and platform legal teams.
- **Negative / Mitigations**: Requires continuous tracking of Indian jurisprudence and MeitY notifications; handled via our versioned policy engine with explicit review dates and source URLs.
