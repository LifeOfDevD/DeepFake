# Contributing to Digital Impersonation Response Desk

Thank you for your interest in contributing to the Digital Impersonation Response Desk.

This repository implements a mission-critical incident-response system operating in the cybersecurity, digital evidence, and statutory compliance domain (IT Rules 2021 & DPDP Act 2023). Because of the sensitive nature of forensic evidence and legal grievance workflows, our contribution standards prioritize architectural discipline, defensive engineering, and rigorous automated verification over rapid, unverified changes.

---

## Core Engineering Invariant

> **Changes affecting security boundaries, evidence custody, tenant isolation, external integrations, statutory clocks, or human-approval boundaries require explicit automated and adversarial verification.**

Any pull request that touches these areas without accompanying test coverage and threat assessment will not be merged.

---

## Getting Started

### Prerequisites
* **Node.js:** v22.0.0 or higher (Active LTS recommended, tested on Node v22.14.0)
* **npm:** v10.0.0 or higher
* **Git:** v2.30+
* **SQLite 3:** Bundled via `better-sqlite3` (C++ build tools required if compiling from source)

### Local Development Setup
1. **Clone the Repository:**
   ```bash
   git clone https://github.com/ChiragArora22/DeepFake.git
   cd DeepFake
   ```

2. **Install Dependencies:**
   ```bash
   npm ci
   ```

3. **Configure Local Environment:**
   ```bash
   cp .env.example .env
   ```
   *Note: Never commit your `.env` file to git.*

4. **Initialize Database Schema & Synthetic Fixtures:**
   ```bash
   npm run seed
   ```

5. **Start Local Development Server:**
   ```bash
   npm run dev
   ```
   The application dashboard will be accessible at `http://127.0.0.1:4000`.

---

## Verification & Testing Standards

All code contributions must pass the complete verification pipeline locally before submitting a pull request.

```bash
# 1. Run strict TypeScript compilation check (0 errors permitted)
npx tsc --noEmit

# 2. Run the complete automated test suite (all 80 files / 447 tests must pass)
npm test

# 3. Run specific test subdomains during development
npm run test:unit
npm run test:integration
npm run test:security
```

### Writing New Tests
* Place unit tests for domain logic in `tests/unit/`.
* Place integration routes and service workflows in `tests/integration/`.
* Place boundary enforcement, input sanitization, and authorization checks in `tests/security/`.
* Follow our established conventions:
  - Mock external network calls completely; tests must run offline with zero internet access.
  - Utilize in-memory or isolated scratch SQLite databases (`:memory:` or unique temp files).
  - Clean up all temporary files in `afterEach` or `afterAll` hooks.

---

## Coding Standards & Architectural Expectations

1. **Strict Type Safety:** Avoid `any`. Use explicit TypeScript interfaces and domain types defined in `src/domain/types.ts`.
2. **Fail-Closed Design:** If a security or validation check encounters unexpected state, the system must fail closed (deny access, block submission, reject file).
3. **Multi-Tenant Scoping:** Every SQL query that reads or writes tenant data must include `WHERE organization_id = ?`. Never rely on route middleware alone for tenant safety.
4. **No Autonomous Outbound Mutations:** The application must never directly invoke external platform APIs (Meta, Google, X) to submit complaints without explicit human review and approval records.
5. **Deterministic Graph Engineering:** When designing workflows, express them as discrete, observable graph nodes with clear inputs, outputs, and rollback boundaries.

---

## Pull Request Guidelines

1. **Branch Naming:**
   - `feature/<short-description>`
   - `fix/<short-description>`
   - `security/<short-description>`
   - `docs/<short-description>`

2. **Commit Messages:**
   Follow Conventional Commits:
   - `feat(evidence): add sha-256 chunked streaming verification`
   - `fix(auth): correct token expiry check in edge conditions`
   - `test(security): add test for path traversal in evidence retrieval`
   - `docs(architecture): document multi-tenant isolation model`

3. **PR Description:**
   Include:
   - What problem does this change solve?
   - What architectural or security boundaries are affected?
   - How was this change tested (unit, integration, adversarial)?
   - Confirmation that all 447 existing tests continue to pass.

---

## Security Disclosures

If your contribution relates to a security vulnerability, please do not open a public pull request or issue. Follow the instructions in [SECURITY.md](SECURITY.md) to report the vulnerability privately.
