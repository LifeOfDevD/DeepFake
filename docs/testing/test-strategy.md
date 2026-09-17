# Test Strategy & Execution Architecture

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  
**Test Framework:** Vitest v3.0.8  

---

## 1. Test Architecture & Progression

The testing pipeline progresses from granular unit isolation to full multi-persona browser acceptance:

```text
1. Unit Tests (23 files, 115 tests)
   └── Validates state machines, mathematical models, triage heuristics, and crypto primitives.
2. Database & Storage Tests (10 files, 57 tests)
   └── Validates incremental migrations (0001-0009), WORM storage, and forensic metadata.
3. Integration Tests (14 files, 87 tests)
   └── Validates multi-service workflows, route mounting, RBAC enforcement, and OAuth PKCE.
4. Security & Hardening Tests (18 files, 112 tests)
   └── Validates token integrity, BOLA isolation, rate limiting, and two-person deletion.
5. Resilience & Failure Injection (2 files)
   └── Validates worker leases, SQLite lock timeouts, and throughput benchmarks.
6. Browser QA & Operator UAT (Scripts & CDP Automation)
   └── Validates DOM rendering, Tailwind styling, role switching, and 24-step golden path.
7. Independent Disproval Suite
   └── Fresh-context adversarial probes testing critical release boundaries.
```

---

## 2. Test Execution Commands

```bash
# Run all 80 test files (447 tests)
npm test

# Run isolated subdomains
npm run test:unit           # 23 files, 115 tests (Domain logic)
npm run test:integration    # 14 files, 87 tests (Service & route integration)
npm run test:security       # 18 files, 112 tests (Security & hardening)

# Run full master graph verification runner
node scripts/execute-master-graph.cjs
```

---

## 3. Subsystem Test Metrics

| Test Category | Directory | File Count | Test Count | Pass Rate | Failure Count |
|---|---|---|---|---|---|
| **Unit Tests** | `tests/unit/` | 23 | 115 | **100%** | 0 |
| **Integration Tests** | `tests/integration/` | 14 | 87 | **100%** | 0 |
| **Security & Hardening** | `tests/security/` | 18 | 112 | **100%** | 0 |
| **Database Migrations** | `tests/database/` | 7 | 35 | **100%** | 0 |
| **Storage & WORM** | `tests/storage/` | 3 | 22 | **100%** | 0 |
| **Resilience & Faults** | `tests/resilience/` | 1 | 6 | **100%** | 0 |
| **Config & Env** | `tests/config/` | 1 | 7 | **100%** | 0 |
| **Services & Hashers** | `tests/services/` | 1 | 9 | **100%** | 0 |
| **Performance Benchmark** | `tests/benchmark/` | 1 | 1 | **100%** | 0 |
| **End-to-End** | `tests/e2e/` | 1 | 8 | **100%** | 0 |
| **Total Automated Suite** | **`tests/`** | **80** | **447** | **100%** | **0** |

---

## 4. Test Isolation Guarantees

1. **Zero External Network Dependencies:** All unit and integration tests execute completely offline. External network calls (YouTube API, WebSub endpoints) are mocked using deterministic test adapters.
2. **Ephemeral Database Sandbox:** Database tests run against isolated in-memory (`:memory:`) databases or unique temporary SQLite files created in `storage/temp/` and cleaned up in `afterEach` hooks.
3. **Deterministic Timers:** Statutory clock and token expiry tests use mock clocks or controlled timestamp offsets to prevent non-deterministic race conditions.
