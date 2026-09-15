# ADR 0001: Modular Monolith Architecture and TypeScript Stack

## Context
The Digital Impersonation Response Desk requires high-integrity transactions, multi-tenant data isolation, deterministic state transitions, audit logging, and responsive user interfaces. The system must operate reliably in both local developer environments and cloud deployments without requiring complex distributed orchestration or excessive container overhead in early phases.

## Decision
We adopt a **Modular Monolith** architecture implemented in **TypeScript** across backend and frontend:
1. **Backend**: Node.js 22 LTS with an Express/Fastify REST API server, validated via Zod schemas.
2. **Database**: SQLite with Write-Ahead Logging (WAL) mode enabled and foreign key enforcement active, accessed via parameterized queries or a type-safe query builder. SQLite provides zero-friction instant test execution, single-file backups, and strict ACID guarantees. The database repository abstraction isolates SQL dialects, allowing seamless migration to PostgreSQL if enterprise scale dictates.
3. **Frontend**: Vite + React 18/19 + Tailwind CSS for a calm, high-density, accessible incident response dashboard.
4. **Testing**: Vitest with Supertest for unified, high-speed unit, integration, and security test execution.

## Consequences
- **Positive**:
  - Instant local environment bootstrap (`npm install && npm test`) without external database daemons.
  - Type sharing between API contracts, state machines, and frontend views.
  - Low cognitive overhead and zero network partition failure modes between internal modules.
- **Negative / Mitigations**:
  - Horizontal scaling requires sticky sessions or moving to PostgreSQL for write concurrency; mitigated by clean repository interfaces enabling PostgreSQL adoption with zero service-layer refactoring.
