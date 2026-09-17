# ADR-007: Controlled Pilot Release Model & GA Gate Discipline

## Status
**Accepted**

## Context
In early SaaS deployments, there is temptation to declare "General Availability (GA)" as soon as internal software tests pass. However, in regulated domains touching corporate identity and forensic evidence, local software stability does not equate to production readiness. Real production readiness requires independent external penetration testing, live hardware WORM storage provisioning, sustained multi-day canary observation, and formal legal counsel endorsement.

## Decision
We establish a strict two-tier release model:
1. **Controlled Pilot / Production-Canary Operation:** The system is authorized for pilot use by enterprise operators under controlled conditions (synthetic data or consented pilot tenants, dry-run billing, disabled live platform mutations).
2. **General Availability (GA) Strictly Withheld:** Promotion to GA is mathematically blocked by a deterministic gate rule until four real-world external assurance activities (`EXT-001`, `CLOUD-001`, `SOAK-001`, `LEG-001`) deliver verified evidence.
3. **Zero Fabrication:** External assurance cannot be mocked, simulated, or self-certified by engineering teams.

## Consequences
* **Positive:** Uncompromised professional integrity; clear risk boundaries for clients and evaluators; rigorous legal defensibility.
* **Tradeoff:** GA promotion cannot occur until external partners (pentest firm, AWS provisioning, legal counsel) complete physical deliverables.
