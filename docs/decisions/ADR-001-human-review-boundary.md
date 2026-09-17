# ADR-001: Mandatory Human Review Boundary for Legal Complaints

## Status
**Accepted**

## Context
When responding to online impersonation campaigns, deepfakes, and copyright infringement, there is pressure to automate end-to-end takedown filing to achieve rapid turnaround. However, autonomous external legal actions create severe liability risks:
1. Automated systems risk misclassifying satire, commentary, or legitimate parody as malicious impersonation, exposing the platform and clients to defamation or tortious interference claims.
2. Intermediaries under Rule 3 of the IT Rules 2021 require verified complainant declarations.
3. AI detector outputs (synthetic media confidence scores) are probabilistic advisory signals, not judicial proof.

## Decision
We enforce an architectural boundary: **The system shall NEVER autonomously file a takedown notice, dispatch an external complaint, or make automated accusations.**

1. All platform complaints must progress through a multi-facet approval state machine (`src/domain/submission-state-machine.ts`).
2. Takedown notice formulation requires independent sign-offs from `LegalCounsel` and `EvidenceSpecialist`.
3. In controlled-pilot mode, `ENABLE_LIVE_PLATFORM_ACTIONS = false` renders notice payloads in `draft` or `simulated_submitted` mode for manual operator review and delivery.

## Consequences
* **Positive:** Complete immunity from runaway automated false-positive takedowns; legal defensibility; adherence to intermediary terms.
* **Tradeoff:** End-to-end notice turnaround requires human review time (bounded by our 24h/72h statutory timers).
