# Documentation Index: Digital Impersonation Response Desk

Welcome to the technical documentation for the **Digital Impersonation Response Desk**.

This repository contains an India-first B2B incident-response system engineered for online impersonation, deepfake synthesis, and executive brand infringement. The documentation is organized into focused domains for architects, security evaluators, SREs, and product engineers.

---

## 🗺️ Documentation Directory Map

```text
docs/
├── README.md                          # You are here: Master documentation portal
├── demo.md                            # 10–15 Minute quick-start operator demonstration
├── project-history.md                 # Complete evolutionary history from Phase 1 to Phase 12
│
├── architecture/                      # System topology, data flow, and components
│   ├── README.md                      # Architecture overview and diagrams
│   ├── system-architecture.md         # Component design (API, Services, Storage, Workers)
│   ├── data-flow.md                   # Intake, triage, evidence custody, and dispatch flows
│   ├── security-boundaries.md         # Trust zones, authentication, and network isolation
│   └── graph-engineering.md          # Multi-agent dependency graph and execution model
│
├── engineering/                       # Deep engineering specifications
│   ├── README.md                      # Engineering practices and technical highlights
│   ├── graph-engineering.md          # Dependency-driven engineering vs serial orchestration
│   └── evidence-chain-of-custody.md   # Streaming SHA-256, WORM storage, and RFC 3161 timestamps
│
├── security/                          # Security architecture, controls, and safety invariants
│   ├── README.md                      # Security model and trust principles
│   ├── threat-model.md                # STRIDE analysis across 6 threat domains
│   ├── authentication.md              # HMAC session tokens, password hashing, rate limiting
│   ├── evidence-security.md           # WORM storage, legal hold overrides, two-person deletion
│   ├── tenant-isolation.md            # Multi-tenant scoping and BOLA/IDOR mitigation
│   ├── worker-security.md             # Background worker leasing and resource sandboxing
│   ├── adversarial-testing.md         # Red-team test suites (11/11 exploit vectors defeated)
│   ├── human-in-the-loop.md           # Mandatory human approval and zero-auto-mutation invariant
│   └── security-boundaries.md         # Isolation of untrusted signals and platform APIs
│
├── testing/                           # Quality assurance, test suites, and verification
│   ├── README.md                      # Testing taxonomy and execution guides
│   ├── test-strategy.md               # Unit, integration, security, and resilience strategy
│   ├── security-testing.md            # Automated security regression and static analysis
│   ├── adversarial-testing.md         # Negative QA and exploit simulation results
│   ├── browser-qa.md                  # CDP browser automation and styling verification
│   ├── operator-uat.md                # 24-step golden path operator acceptance test report
│   └── verification-matrix.md         # Ground-truth 17-gate assurance status matrix
│
├── assurance/                         # Production readiness and external assurance gates
│   ├── README.md                      # Assurance governance and release gate logic
│   └── current-status.md              # Authoritative status of EXT-001, CLOUD-001, SOAK-001, LEG-001
│
├── operations/                        # Production operations, SRE runbooks, and disaster recovery
│   ├── README.md                      # Operations portal and checklist
│   └── runbooks.md                    # Backup, restore, key rotation, and kill-switch runbooks
│
├── product/                           # Domain problem, statutory framework, and playbooks
│   ├── README.md                      # Product overview
│   ├── product-overview.md            # Problem statement, market need, and persona definitions
│   └── statutory-framework.md         # IT Rules 2021, IT Act 2000, DPDP 2023, and GAC appeals
│
└── decisions/                         # Architecture Decision Records (ADRs)
    ├── README.md                      # ADR directory and governance
    ├── 0001-modular-monolith-tech-stack.md
    ├── 0002-india-first-legal-and-platform-taxonomy.md
    ├── 0003-human-in-the-loop-safeguards.md
    ├── 0004-evidence-storage-and-chain-of-custody.md
    ├── ADR-001-human-review-boundary.md
    ├── ADR-002-evidence-chain-of-custody.md
    ├── ADR-003-read-only-provider-integrations.md
    ├── ADR-004-kill-switch.md
    ├── ADR-005-tenant-isolation.md
    ├── ADR-006-graph-based-workflow-orchestration.md
    └── ADR-007-controlled-pilot-release-model.md
```

---

## ⚡ Quick Links for Evaluators

1. **Want to evaluate the project in 10 minutes?**  
   Read [`docs/demo.md`](demo.md) for a self-contained synthetic operator journey.
2. **Want to inspect the system architecture?**  
   Read [`docs/architecture/system-architecture.md`](architecture/system-architecture.md) and [`docs/architecture/data-flow.md`](architecture/data-flow.md).
3. **Want to verify security invariants?**  
   Read [`docs/security/human-in-the-loop.md`](security/human-in-the-loop.md) and [`docs/security/threat-model.md`](security/threat-model.md).
4. **Want to understand why GA is withheld?**  
   Read [`docs/assurance/current-status.md`](assurance/current-status.md) to inspect the four external assurance blockers (`EXT-001`, `CLOUD-001`, `SOAK-001`, `LEG-001`).
