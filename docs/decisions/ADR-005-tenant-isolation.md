# ADR-005: Multi-Tenant Scoping & Database-Level BOLA Defense

## Status
**Accepted**

## Context
In multi-tenant SaaS environments, reliance solely on route middleware for authorization often leads to Broken Object-Level Authorization (BOLA / IDOR) when new endpoints are introduced or route guards are accidentally omitted.

## Decision
We enforce multi-tenant isolation at **two independent defensive layers**:
1. **Middleware Context Extraction (`src/middleware/tenant.ts`):** Validates active tenant membership from the authenticated session token and binds `organizationId` to the request context.
2. **Mandatory Query Scoping in Domain Services:** All SQL statements that access tenant data (cases, evidence, signals, playbooks, reports) must include `WHERE organization_id = ?` directly in the prepared statement.
3. **Anti-Enumeration via 404:** If a query with a valid ID returns 0 rows because the record belongs to another organization, the service throws `NotFoundError` (`HTTP 404`), preventing attackers from enumerating valid resource IDs.

## Consequences
* **Positive:** Complete protection against cross-tenant data leakage even if route middleware is misconfigured; zero resource ID enumeration.
* **Tradeoff:** Every SQL query requires tenant parameter binding; cross-tenant administrative reporting requires specialized audited bypasses.
