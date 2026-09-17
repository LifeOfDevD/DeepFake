# Architecture Decision Records (ADRs)

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  

---

## Overview

This directory captures the key architectural, security, and statutory compliance decisions made during the design and implementation of the Digital Impersonation Response Desk.

All decisions adhere to the [Architecture Decision Record](https://github.com/joelparkerhenderson/architecture-decision-record) standard, documenting context, options considered, decisions taken, and consequences.

---

## ADR Index

| ADR ID | Title | Status | Primary Driver |
|---|---|---|---|
| **ADR-001** | [Human Review Boundary](ADR-001-human-review-boundary.md) | **Accepted** | Prevention of autonomous harm and defamation liability |
| **ADR-002** | [Forensic Evidence Chain of Custody](ADR-002-evidence-chain-of-custody.md) | **Accepted** | Section 65B Indian Evidence Act / Section 63 BSA compliance |
| **ADR-003** | [Read-Only Provider Integrations](ADR-003-read-only-provider-integrations.md) | **Accepted** | Intermediary API terms compliance and zero automated takedowns |
| **ADR-004** | [Emergency Integration Kill Switch](ADR-004-kill-switch.md) | **Accepted** | Operational containment of rogue webhooks and API faults |
| **ADR-005** | [Multi-Tenant Scoping & BOLA Defense](ADR-005-tenant-isolation.md) | **Accepted** | Strict tenant isolation at database query layer |
| **ADR-006** | [Graph-Based Workflow Orchestration](ADR-006-graph-based-workflow-orchestration.md) | **Accepted** | Deterministic assurance gating and fan-out/fan-in pipelines |
| **ADR-007** | [Controlled Pilot Release Model](ADR-007-controlled-pilot-release-model.md) | **Accepted** | Strict withholding of GA pending real-world external assurance |

---

## Historical Phase Decisions
* [`0001-modular-monolith-tech-stack.md`](0001-modular-monolith-tech-stack.md): Selection of Node.js 22, Express, TypeScript, and SQLite WAL.
* [`0002-india-first-legal-and-platform-taxonomy.md`](0002-india-first-legal-and-platform-taxonomy.md): Alignment with IT Rules 2021 and IT Act 2000.
* [`0003-human-in-the-loop-safeguards.md`](0003-human-in-the-loop-safeguards.md): Foundation of HITL governance.
* [`0004-evidence-storage-and-chain-of-custody.md`](0004-evidence-storage-and-chain-of-custody.md): Streaming SHA-256 and WORM storage design.
