# ADR 0003: Mandatory Human-In-The-Loop (HITL) Governance & Ethical Safeguards

## Context
Automated abuse reporting systems risk weaponization, accidental suppression of legitimate free speech, defamation of innocent parties, and erroneous legal claims. Furthermore, probabilistic AI deepfake detectors frequently yield false positives or false negatives depending on video compression, lighting, or dialect.

## Decision
We enforce mandatory architectural safeguards across all operational workflows:
1. **Human Gate on External Dispatches**:
   - No external notice, email, webhook, or platform grievance can be transmitted without explicit human approval.
   - The state transition to `submitted` is blocked at the database and API layer unless an `ActionApproval` record signed by a qualified user (`Legal Reviewer` or `Case Manager`) is attached.
2. **AI Advisory Role Only**:
   - AI algorithms and third-party deepfake detectors are restricted to generating draft suggestions and probabilistic confidence scores.
   - Detector confidence scores are visibly flagged as advisory in the UI.
   - AI outputs are never presented as legally binding determinations of guilt or illegality.
3. **Strict Exclusion of CSAM and NCII**:
   - Child Sexual Abuse Material (CSAM) and Non-Consensual Intimate Imagery (NCII) are strictly excluded from commercial desk handling.
   - Automated keyword and operator triage triggers an immediate `blocked` state, quarantine of media files, and emergency guidance directing operators to report directly to law enforcement (NCRP / `cybercrime.gov.in` / `1930`).
4. **Default Dry-Run Mode**:
   - All external platform adapters default to a deterministic dry-run simulator (`DryRunExternalActionAdapter`) until explicitly enabled by an organization administrator with verified credentials.

## Consequences
- **Positive**: Complete defense against accidental defamation, malicious automated takedowns, and legal liability. Compliance with Indian intermediary due diligence standards.
- **Negative / Mitigations**: Requires operational human staffing to review and approve notices; mitigated by structured pre-drafted forms and clear evidence summaries that reduce review time to seconds.
