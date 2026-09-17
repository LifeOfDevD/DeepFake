# ADR-002: Forensic Evidence Custody & Streaming SHA-256 Architecture

## Status
**Accepted**

## Context
Digital evidence in cyber impersonation incidents must meet the strict standards of Section 65B of the Indian Evidence Act, 1872 / Section 63 of Bharatiya Sakshya Adhiniyam, 2023 for admissibility in court. Common vulnerabilities include buffer-exhaustion attacks during uploads, filename-based path traversal, post-upload tampering, and unauthorized deletion.

## Decision
We implement a streaming, WORM-compliant forensic evidence custody pipeline:
1. **Streaming SHA-256:** File digests are calculated incrementally on the byte stream during multipart upload (`evidence-hasher.ts`), keeping memory usage constant ($O(1)$) up to the 50 MB limit.
2. **Opaque Storage Keys:** Files are renamed to random UUID v4 keys (`ev_<uuid>.bin`) outside the web root to eliminate path traversal.
3. **WORM Storage:** Local storage simulates WORM behavior; production cloud storage configures AWS S3 Object Lock in strict `COMPLIANCE` mode with a minimum 180-day retention lock (matching Rule 3(1)(h) IT Rules 2021).
4. **Token-Gated Retrieval:** Direct access is blocked; downloading requires short-lived (300s) HMAC-SHA256 tokens.
5. **Legal Hold Overrides:** Active legal holds programmatically block deletion requests (HTTP 409).

## Consequences
* **Positive:** Cryptographically unassailable chain of custody; Section 65B certificate readiness; protection against insider tampering.
* **Tradeoff:** Deleted files cannot be purged until the 180-day statutory window expires or requires formal multi-party authorization.
