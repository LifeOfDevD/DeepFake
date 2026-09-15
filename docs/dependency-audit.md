# Supply Chain & Dependency Security Audit

**Document Version:** 1.0.0  
**Status:** AUDITED & CONTROLLED  
**Target Environment:** Digital Impersonation Response Desk (Staging / Production Canary)  
**Last Audit Timestamp:** 2026-09-13T23:55:00+05:30  

---

## 1. Executive Summary

This document presents the software bill of materials (SBOM) summary, automated vulnerability audit results (`npm audit`), and risk mitigations for the **Digital Impersonation Response Desk**.

The operational candidate utilizes **263 total packages** across its dependency graph:
- **Production Dependencies:** 8 direct packages (125 total transitive packages)
- **Development & Test Dependencies:** 10 direct packages (139 total transitive packages)
- **Zero (0) Critical Severity Vulnerabilities**
- **Zero (0) High Severity Vulnerabilities**
- **Four (4) Moderate Severity Advisories** (detailed below with operational risk assessments and architectural mitigations)

---

## 2. Production vs. Non-Production Dependency Isolation

Our multi-stage Docker build architecture strictly isolates build and test dependencies from the final production runtime container:

```mermaid
graph LR
    subgraph BuildStage [Build Container (node:22-alpine)]
        AllDeps[All Dependencies - 263 pkgs] --> TSC[TypeScript Compiler tsc]
        TSC --> Dist[Compiled JS in dist/]
    end

    subgraph RuntimeStage [Production Container (distroless/minimal)]
        ProdDeps[Production Only - npm ci --only=production]
        Dist --> App[Runtime Application Node dist/src/server.js]
        ProdDeps --> App
        NoVitest[DevDependencies Excluded: vitest, @vitest/mocker, tsx]
    end
```

Because development tooling (such as `vitest` and `tsx`) is never packaged into the production container image, vulnerabilities in dev tooling have zero attack surface in staging and production environments.

---

## 3. Detailed Vulnerability Inventory & Mitigation Assessment

### 3.1 Advisory 1 & 2: Vitest Mocking Subsystem (`@vitest/mocker` / `vitest`)

| Field | Detail |
|---|---|
| **Advisory ID** | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| **CVE** | CWE-22 (Path Traversal / Arbitrary File Read via `@vitest/mocker` Redirect Mock) |
| **Severity** | Moderate (CVSS 5.9: `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`) |
| **Affected Components** | `node_modules/@vitest/mocker` (transitive via `vitest@3.0.8`) |
| **Scope** | `devDependencies` only (Test Runner) |
| **Production Impact** | **ZERO IMPACT.** Neither `vitest` nor `@vitest/mocker` is included in the production Docker image or production node_modules. |
| **Remediation Strategy** | A future upgrade to `vitest@5.0.0` introduces major breaking configuration changes to Vitest plugins and runner APIs. Since Vitest runs only during offline local/CI test suites on trusted test files, the risk is accepted pending the next planned major framework migration. |

---

### 3.2 Advisory 3 & 4: Express Query Parser Subsystem (`qs`)

| Field | Detail |
|---|---|
| **Advisories** | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) (Array-limit bypass via bracket-key comma parsing)<br>[GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) (DoS via Attacker Controlled isBuffer) |
| **CVEs** | CWE-770 (Allocation of Resources Without Limits), CWE-248 / CWE-703 |
| **Severity** | Moderate (CVSS 3.7 & 5.3) |
| **Affected Components** | `node_modules/express/node_modules/qs` (via `express@4.21.2`) |
| **Scope** | Production Transitive Runtime |
| **Attack Vector** | An attacker passes malformed, deeply nested bracketed query string parameters (`?a[b][c]...`) or buffer-like arrays to trigger disproportionate memory allocation or prototype key parsing in query parsers. |
| **Operational & Architectural Mitigations in Codebase:** | 1. **Request Body Size Limits:** Express JSON body parser is capped at `1mb` (`express.json({ limit: '1mb' })`).<br>2. **Strict Zod Query Validation:** All API endpoints define explicit Zod schemas that parse and strip unexpected query parameters (`z.object({ ... }).strict()` or explicit scalar query params).<br>3. **Rate Limiting:** Unauthenticated endpoints are protected by `express-rate-limit` (10 requests/minute on auth; 300 requests/minute globally), preventing query-flooding DoS.<br>4. **Upstream Tracking:** Once Express releases `4.22.3` or `5.x` GA with updated `qs@6.16.0+`, an in-place minor patch will be applied. |

---

## 4. Supply Chain Integrity & Defense-in-Depth

1. **Deterministic Lockfile Enforcement:**  
   All builds and deployments run `npm ci --ignore-scripts` to prevent arbitrary lifecycle script execution during package downloads, pinning exact package checksums from `package-lock.json`.

2. **Minimal Direct Dependencies:**  
   The application intentionally avoids large, unvetted utility suites (e.g., `lodash`, `request`). Core libraries are limited to industry-standard primitives:
   - Web framework: `express`
   - Data validation: `zod`
   - Database: `better-sqlite3`
   - Cryptography & Security: native Node.js `crypto`, `helmet`, `cors`
   - File uploads: `multer` with memory storage and strict byte/type inspection

3. **Continuous Supply Chain Monitoring:**  
   - CI pipeline incorporates `npm audit --audit-level=high` as a non-negotiable pull-request blocker.
   - Dependabot / Renovate automated scanning configured for weekly security patch PRs.

---

## 5. Compliance Disclaimer

Passing automated `npm audit` scans and implementing dependency mitigations does **NOT** constitute SOC 2 Type II supply-chain certification or formal third-party software supply-chain assurance. Formal external verification by certified third-party security auditors is required prior to unconstrained public production operation.
