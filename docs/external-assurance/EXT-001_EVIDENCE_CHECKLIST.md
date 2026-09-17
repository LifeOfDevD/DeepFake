# EXT-001: External Security Assessment Evidence Checklist

**Target Application:** Digital Impersonation Response Desk  
**Target Release:** `v1.0.0-controlled-pilot-rc2`  
**Closure Gate:** EXT-001  
**Date:** 2026-09-16  

---

## 1. Mandatory Evidence Criteria for Gate Closure

To transition `EXT-001` from `OPEN` / `IN_PROGRESS` to `VERIFIED` in `results/ASSURANCE_REGISTER.json`, the following formal evidentiary artifacts must be delivered by the external assessor:

| Item # | Required Evidence Item | Verification Criteria | Status |
|---|---|---|---|
| **EVD-EXT-01** | Signed Formal Penetration Testing Report | Issued by an accredited, independent external cybersecurity assessment firm. Must include dates of assessment, test methodology, and lead assessor signature. | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-02** | Target Scope & Commit Attestation | Written confirmation that testing targeted release candidate `v1.0.0-controlled-pilot-rc2` (Commit: `e7db64c`) on the agreed staging enclave. | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-03** | Multi-Tenant IDOR Attestation | Explicit test evidence confirming zero horizontal cross-tenant data access between Organization A (`Apex Healthcare`) and Organization B (`BharatFin`). | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-04** | Cryptographic Custody & Legal Hold Evidence | Test evidence demonstrating that statutory legal holds prevent evidence deletion (HTTP 409) and the Two-Person rule prevents requester self-approval. | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-05** | SSRF Defense-in-Depth Verification | Confirmation that link-local cloud metadata addresses (`169.254.169.254`) and private RFC 1918 subnets are strictly blocked with HTTP 400. | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-06** | Normalized Findings Register | All identified vulnerabilities cataloged with CVSS v3.1 scores, CWE classifications, and raw reproduction request/response transcripts. | **PENDING EXTERNAL ASSESSMENT** |
| **EVD-EXT-07** | Remediation & Re-Test Sign-Off | Written attestation that all Critical (P0) and High (P1) findings have been remediated, re-tested, and verified closed. | **PENDING EXTERNAL ASSESSMENT** |

---

## 2. Gate Decision Rules

1. **NO CRITICAL OR HIGH OPEN FINDINGS:** If any Critical or High severity finding remains open, `EXT-001` cannot be marked `VERIFIED`, and General Availability remains `BLOCKED`.
2. **MEDIUM / LOW ACCEPTANCE:** Medium and Low severity findings (e.g., Tailwind CDN `'unsafe-eval'`) may be accepted for Controlled Pilot operation provided documented mitigations exist, but must be formally evaluated before GA.
3. **ZERO FABRICATION RULE:** Internal test results, developer assertions, or local automated test logs shall never be substituted for EVD-EXT-01 through EVD-EXT-07.
