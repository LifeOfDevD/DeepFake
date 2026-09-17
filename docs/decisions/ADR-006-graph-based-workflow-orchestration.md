# ADR-006: Graph-Based Workflow Orchestration for Quality & Assurance

## Status
**Accepted**

## Context
Complex release verification and statutory incident workflows involve multiple interdependent tasks: static compilation, unit testing, adversarial security validation, browser rendering checks, infrastructure reviews, and legal briefing. Structuring these as linear shell scripts creates artificial serialization, slows feedback loops, and obscures failure containment.

## Decision
We adopt **Graph Engineering** (Directed Acyclic Graphs) for operational workflows and release gating:
1. **Discrete Nodes:** Every task is an isolated node with explicit input dependencies and typed output artifacts.
2. **Parallel Fan-Out:** Once prerequisites complete, independent investigations (e.g., Security, Cloud, Canary, Legal) fan out concurrently.
3. **Evidence Reduction:** Output artifacts fan into an evidence reducer before deterministic gate evaluation.
4. **Independent Disproval:** A separate verification node actively executes negative tests to disprove readiness claims before release sign-off.

## Consequences
* **Positive:** High visibility into critical paths; clear audit trail of deliverables; parallel execution speed; zero hidden assumptions.
* **Tradeoff:** Requires formalizing input/output schemas for each node and managing artifact persistence.
