# Digital Impersonation Response Desk: Testing Strategy & Acceptance Verification

## 1. Testing Philosophy
The integrity of the Digital Impersonation Response Desk relies on rock-solid tenant boundaries, tamper-evident evidence logs, and deterministic state transitions. We mandate a multi-layered testing pyramid executed through Vitest, Supertest, and Playwright.

---

## 2. The 10 Testing Layers

| Layer | Test Scope & Purpose | Tools & Frameworks |
| :--- | :--- | :--- |
| **1. Unit Tests** | Domain models, validation logic, SHA-256 calculators, statutory clock calculators. | Vitest |
| **2. Database & Migration Tests** | Schema migrations up/down, foreign key cascades, unique constraints, SQLite WAL concurrency. | Vitest + SQLite in-memory / temp DB |
| **3. API Tests** | REST contracts, Zod schema validation, error response envelopes, HTTP status codes. | Vitest + Supertest |
| **4. Authorization Tests** | Tenant isolation negative tests, role-based action permission gates (e.g. Analyst vs Legal Reviewer). | Vitest + Supertest with role fixtures |
| **5. Evidence Access Tests** | Signed URL generation, HMAC verification, expiration enforcement, download audit logging. | Vitest + Crypto mock |
| **6. Workflow State Machine Tests** | All valid and invalid transitions in the case lifecycle, rejection of illegal state skips. | Vitest state machine matrix |
| **7. Adapter Contract Tests** | Dry-run external action adapters, simulation of all platform response codes (rate limit, duplicate, rejected). | Vitest contract test suite |
| **8. End-to-End (E2E) Browser Tests** | Critical operational flows: login -> create case -> upload evidence -> triage -> draft notice -> approve -> dry-run submit. | Playwright |
| **9. Security Regression Tests** | Path traversal, SSRF IP blocking, malicious file upload rejection (.exe, .sh), XSS sanitization, prompt injection sandboxing. | Vitest security test suites |
| **10. Cost & Retry Tests** | Idempotency keys, exponential backoff with jitter on platform timeouts, tracking of provider token/API credits. | Vitest fake timers & retry harness |

---

## 3. Test Fixtures Strategy
All test data is completely synthetic and strictly vetted:
- Zero real people, phone numbers, or residential addresses.
- Synthetic brand names: `ApexHealth Clinic`, `BharatFin Wealth`, `Dr. Synthetic Sharma`.
- Synthetic contested URLs: `https://fake-instagram.example/dr_synthetic`, `https://scam-telegram.example/bharatfin_deals`.
- Safe mock files: PNG test blocks, sample text transcripts, mock audio waveforms.
- Excluded test fixtures: Mock triggers for CSAM/NCII keywords that test immediate quarantine without containing any actual illicit material.

---

## 4. Acceptance Gates and Automation Commands

### Phase 2 Verified Test Suites (58 Tests across 12 Suites)
- `tests/services/evidence-hasher.test.ts`: 9 tests verifying streaming SHA-256 calculation, magic-byte MIME identification, file size limit enforcement, and executable rejection.
- `tests/storage/evidence-storage.test.ts`: 7 tests verifying storage abstraction, path traversal protection, directory isolation, atomic rename, and in-memory storage.
- `tests/database/migrations.test.ts`: 6 tests verifying migrations runner, tracking table, and schema constraints.
- `tests/integration/evidence-authorization.test.ts`: 5 tests verifying cross-tenant download prevention, role gates on upload/deletion, and quarantined evidence access control.
- `tests/integration/evidence-lifecycle.test.ts`: 6 tests verifying source URL hashing, legal hold locking, two-person deletion workflow, and signed token expiration.
- `tests/security/evidence-safety.test.ts`: 4 tests verifying filename sanitization, SSRF localhost rejection, automated quarantine of prohibited items, and audit trail safety.
- `tests/e2e/evidence-journey.test.ts`: Comprehensive 13-step operational journey across roles (Analyst upload -> Manager review -> Counsel legal hold -> Owner deletion).

### Verification Commands
```bash
# Run full suite
npm test

# Run build compilation check
npm run build

# Run synthetic seed fixtures
npm run seed
```
