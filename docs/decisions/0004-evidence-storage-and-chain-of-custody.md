# ADR 0004: Evidence Storage Abstraction, Cryptographic Integrity, and Chain of Custody

## Status
Accepted

## Date
2026-09-12

## Context
In impersonation and synthetic-media incident response across Indian jurisdictions (IT Act 2000, IT Rules 2021, Bharatiya Nyaya Sanhita 2023, Bharatiya Sakshya Adhiniyam 2023), digital proof constitutes evidentiary material. Legal counsel, law enforcement, platform grievance officers, and the Grievance Appellate Committee (GAC) require demonstrably intact, un-tampered digital assets with an unbroken chain of custody.

Furthermore, evidence handling carries severe operational risks:
1. Malicious executable payload uploads (polyglot scripts, `.exe`, shell scripts disguised as images).
2. Hostile file paths causing directory traversal attacks.
3. Premature or accidental deletion of critical proof during active legal or police proceedings.
4. Leaks of severe prohibited content (e.g., CSAM, Non-Consensual Intimate Imagery / NCII) causing secondary harm or statutory exposure.
5. Inadvertent cross-tenant data leakage in multi-tenant environments.

## Decision
We establish the following architectural choices for Phase 2: Evidence Locker and Chain of Custody:

1. **Storage Abstraction (`EvidenceStorage` Interface)**:
   - Provide a clean storage interface supporting `put`, `get`, `delete`, and `exists`.
   - Implement `LocalEvidenceStorage` with atomic temporary writes and rename, strict directory isolation, and path-traversal prevention (`path.normalize` and prefix containment).
   - Implement `InMemoryEvidenceStorage` for high-speed, zero-filesystem test execution.
   - Storage keys strictly follow tenant-isolated namespaces: `evidence/{org_id}/{case_id}/{evidence_id}/{filename}`.

2. **Streaming SHA-256 and MIME Validation Pipeline**:
   - Single-pass streaming pipeline calculates SHA-256 digests on write.
   - Rejects files exceeding strict category ceilings (e.g., 50MB for images, 500MB for video).
   - Validates file content using magic byte sniffing.
   - Enforces strict executable blocklists (`.exe`, `.bat`, `.sh`, `.cmd`, `.msi`, `.elf`, `.com`, `.scr`, `.vbs`).

3. **Chain of Custody & Audit Logging**:
   - Every lifecycle event is immutably recorded in both `evidence_access_events` and the tenant `audit_events` ledger.
   - Access types include: `uploaded`, `viewed`, `downloaded`, `marked_sensitive`, `quarantined`, `legal_hold_placed`, `legal_hold_released`, `deletion_requested`, `deletion_approved`.

4. **Time-Limited HMAC-Signed Download Tokens**:
   - Direct unauthenticated asset URLs are prohibited.
   - Downloads require either authenticated session context with verified tenant membership or an ephemeral HMAC-SHA256 signed token valid for at most 300 seconds.
   - Tokens bind the requesting user ID, target evidence ID, organization ID, and unix expiration timestamp.

5. **Legal Hold and Retention Governance**:
   - Default statutory retention period is set to 180 days (extendable per tenant policy).
   - Legal holds (`evidence_retention_holds`) act as immutable hard locks: an item with an active legal hold cannot be deleted or expired by any operator.
   - Deletion requires a two-person rule: an analyst or manager submits a deletion request (`deletion_requested`), and an organization owner, legal reviewer, or system administrator must explicitly approve (`deletion_approved`) before storage purging occurs.

6. **Statutory Quarantine and Preview Suppression**:
   - Assets marked `prohibited` or `quarantined` (e.g., suspected CSAM, NCII, or severe bodily harm) have raw rendering, thumbnail generation, and browser previews strictly suppressed.
   - Access is restricted exclusively to authorized Legal Reviewers, Organization Owners, and System Administrators for statutory escalation to the National Cyber Crime Reporting Portal (NCRP) at `cybercrime.gov.in` or Helpline `1930`.

## Consequences
- **Positive**: Complete compliance with Indian digital evidence standards (BSA 2023 Sec 63); complete tenant segregation; full protection against malicious uploads and unauthorized access.
- **Negative**: Multipart streaming and hash calculations add minor CPU overhead on ingestion; two-person deletion workflow requires organizational discipline.
