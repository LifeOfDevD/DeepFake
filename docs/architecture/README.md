# System Architecture Overview

**Application:** Digital Impersonation Response Desk  
**Target Environment:** Node.js 22 LTS / Express / TypeScript / SQLite (WAL) / AWS S3 WORM  
**Release Baseline:** `v1.0.0-controlled-pilot-rc2`  
**Operating Posture:** Controlled Pilot / Production-Canary Only  

---

## 1. High-Level Architectural Vision

The Digital Impersonation Response Desk is architected as an **auditable, event-driven modular monolith**. It is engineered specifically to meet the high-stakes evidentiary, cryptographic, and statutory requirements of cybersecurity incident response under Indian cyber law (IT Act 2000, IT Rules 2021, and DPDP Act 2023).

```mermaid
graph TD
    subgraph Client Tier
        UI["Web Single Page Application (HTML/JS/Tailwind)"]
    end

    subgraph Edge & Security Boundary
        Proxy["Reverse Proxy / ALB (TLS Termination)"]
        SecHeaders["Security Headers (Helmet / CSP / CORS)"]
        RateLimiter["Sliding Window Rate Limiter"]
        AuthMiddleware["HMAC Bearer Token Auth & RBAC"]
        TenantGuard["Multi-Tenant Isolation Guard (WHERE org_id = ?)"]
    end

    subgraph Application Tier
        Router["Express API Router (21 Modular Route Sets)"]
        Services["Domain Services (Triage, Playbooks, Evidence, Submissions)"]
        StateMachines["Finite State Machines (Case, Evidence, Approvals)"]
        WorkerManager["Background Worker Pool (8 Persistent Workers)"]
    end

    subgraph Data & Storage Tier
        SQLite[("Primary Relational DB (better-sqlite3 / WAL Mode)")]
        LocalWORM[("Local Staging Storage (HMAC Download Tokens)")]
        AWS_S3[("AWS S3 Evidence Vault (COMPLIANCE Mode WORM)")]
        AWS_KMS[("AWS KMS CMK (ap-south-1 Multi-AZ)")]
    end

    subgraph External Platforms (Strictly Controlled)
        YouTube["YouTube Data API (Read-Only Scope)"]
        WebSub["WebSub Inbound Webhooks (HMAC Verified)"]
        KillSwitch{"Emergency Kill Switch (Active Guard)"}
    end

    UI --> Proxy --> SecHeaders --> RateLimiter --> AuthMiddleware --> TenantGuard --> Router
    Router --> Services
    Services --> StateMachines
    Services --> SQLite
    Services --> LocalWORM
    Services -.-> AWS_S3
    AWS_S3 -.-> AWS_KMS
    WorkerManager --> SQLite
    Services --> KillSwitch
    KillSwitch --> YouTube
    WebSub --> KillSwitch
```

---

## 2. Core Architectural Pillars

1. **Deterministic State Transitions:** All incident progressions, evidence classifications, and takedown submissions are governed by formal finite state machines (`src/domain/*-state-machine.ts`). Invalid state hops are rejected at the domain layer.
2. **Immutable Forensic Custody:** Digital evidence is hashed using streaming SHA-256 at the ingestion boundary. Deletion is blocked on active legal holds and requires multi-person authorization.
3. **Hardened Multi-Tenancy:** Separation of tenant data is enforced at the database query layer via mandatory parameterized `organization_id` predicates, preventing BOLA/IDOR vulnerabilities.
4. **Mandatory Human Approval Boundary:** No complaint or notice can be dispatched to an external provider without multi-role human sign-off (Legal Counsel + Case Manager). Autonomous takedown actions are forbidden by design.
5. **Fail-Closed Runtime Safety:** If external dependencies fail or security assertions encounter unexpected state, the system halts or trips circuit breakers, preventing unintended operations.

---

## 3. Subsystem Architecture Guides

* [System Architecture Specification](system-architecture.md): Detailed component breakdown, database schema, and worker mechanics.
* [Data Flow Architecture](data-flow.md): End-to-end trace from raw signal intake to statutory complaint generation.
* [Security Boundaries](security-boundaries.md): Trust zones, network controls, and secret isolation.
* [Graph Engineering Execution Model](graph-engineering.md): How complex asynchronous assurance and operational workflows are structured as directed acyclic graphs.
