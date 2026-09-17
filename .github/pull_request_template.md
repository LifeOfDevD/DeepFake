## Description
<!-- Provide a brief description of the problem solved and the implementation approach -->

## Architectural & Security Invariant Checklist
Please verify the following before requesting review:
- [ ] Multi-tenant queries include explicit `WHERE organization_id = ?` parameterization.
- [ ] Zero outbound live platform mutations or autonomous takedown logic introduced.
- [ ] Forensic evidence handling preserves streaming SHA-256 integrity and WORM constraints.
- [ ] Role-based access control (RBAC) permissions verified on any new or modified routes.
- [ ] No hardcoded secrets, test credentials, or real customer data added.

## Verification & Testing
- [ ] Strict TypeScript compilation passes (`npx tsc --noEmit`) with 0 errors.
- [ ] Full Vitest automated test suite passes (`npm test`) with 0 failures (80 files / 447 tests).
- [ ] New unit, integration, or security tests added covering this change.

## Documentation
- [ ] Architecture documentation or ADR updated if this change alters core boundaries.
- [ ] CHANGELOG.md updated if applicable.
