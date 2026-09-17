# ADR-004: Emergency Integration Kill Switch

## Status
**Accepted**

## Context
In production operations, external integrations may experience unexpected failure modes: provider webhook flooding, API quota exhaustion, upstream service degradation, or malicious payload replay attacks. Operators must be able to immediately isolate the system from external traffic without taking down the entire core application or interrupting internal analysts.

## Decision
We implement a dedicated, persistent **Emergency Kill Switch** (`src/services/integrations/circuit-breaker.ts`):
1. **Administrative Control:** Accessible via authenticated API (`POST /api/integrations/kill-switch`) restricted to `SystemAdmin` and `OrgAdmin` roles.
2. **Immediate Enforcement:** When tripped (`ARM`), all inbound webhook endpoints immediately reject traffic with `HTTP 503 Service Unavailable: KILL_SWITCH_ACTIVE`.
3. **Background Worker Isolation:** Background sync workers check the kill-switch state before initiating outbound network requests.
4. **Internal Continuity:** Internal incident triage, evidence review, and case management remain 100% operational during kill-switch activation.

## Consequences
* **Positive:** Rapid, sub-second containment of external integration emergencies with zero data corruption.
* **Tradeoff:** During kill-switch activation, new external signals must be queued or manually ingested.
