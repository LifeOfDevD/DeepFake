# Standard Operating Procedure: Evidence Ingestion, Preservation, and Chain of Custody

## 1. Objective and Statutory Context
Under Indian law (Bharatiya Sakshya Adhiniyam 2023, Section 63; Information Technology Act 2000, Section 65B/79; Information Technology Rules 2021), electronic evidence tendered in legal petitions, police complaints, or grievance escalations requires continuous integrity verification and an indisputable chain of custody.

The **Digital Impersonation Response Desk** Evidence Locker provides an isolated, multi-tenant vault where digital artifacts (screenshots, video recordings, audio deepfakes, PDF certificates, source URLs) are stored with tamper-evident cryptographic controls.

---

## 2. Evidence Ingestion Workflow

```
[ Incoming Digital Asset ]
         │
         ▼
[ Magic Byte & MIME Sniffing ] ──► (Executable detected: .exe, .sh, .bat) ──► [ REJECT 400 ]
         │
         ▼ (Supported: image, video, audio, pdf, text, source_url)
[ Streaming SHA-256 Digest ] ──► (Exceeds size ceiling: e.g. 50MB img / 500MB vid) ──► [ REJECT 400 ]
         │
         ▼
[ Atomic Write to Storage ] ──► `evidence/{tenant_id}/{case_id}/{evidence_id}/{filename}`
         │
         ▼
[ Metadata Insert (`evidence_items`) ]
         │
         ▼
[ Access Event & Audit Ledger Record ]
```

### 2.1 File Format Policies
- **Images**: PNG, JPEG, WEBP (Max: 50MB)
- **Videos**: MP4, WebM (Max: 500MB)
- **Audio**: MP3, WAV, WebM (Max: 100MB)
- **Documents**: PDF (Max: 100MB)
- **Prohibited Extensions**: `.exe`, `.bat`, `.sh`, `.cmd`, `.msi`, `.elf`, `.com`, `.scr`, `.vbs` (Strict rejection at gateway)

### 2.2 Filename Sanitization
All original filenames undergo aggressive sanitization to eliminate path traversal characters (`..`, `/`, `\`) and non-ASCII or hostile control characters. The sanitized name is stored in `safe_display_name` while the raw name is preserved solely for audit purposes in `original_filename`.

---

## 3. Cryptographic Chain of Custody

### 3.1 Streaming Hashing
Every byte ingested into the Evidence Locker is streamed directly through Node.js crypto SHA-256 engines. The resulting hexadecimal digest is stored in `evidence_items.sha256` and returned as an HTTP `ETag` on retrieval.

### 3.2 Immutability Invariant
Once written, stored bytes cannot be modified in place. Any modification (such as redaction) creates a new distinct evidence item with its own unique ID, cryptographic digest, and pointer to the parent asset.

### 3.3 Audit Ledger Correlation
Every action involving an evidence item records:
- An entry in `evidence_access_events` with detailed access attributes.
- An entry in the tenant-wide append-only `audit_events` ledger.

---

## 4. Download and Egress Safeguards

1. **No Public Storage URLs**: Storage keys are never exposed directly to clients or public CDNs.
2. **Role-Based Token Generation**: A user must authenticate and possess authorized tenant membership to request an ephemeral HMAC-SHA256 download token (`POST /api/evidence/:id/token`).
3. **Short Expiry Window**: Tokens expire automatically after 300 seconds (5 minutes).
4. **Parameter Binding**: The HMAC signature binds the `evidence_id`, `organization_id`, `user_id`, and `expires_at` timestamp. Tampered tokens or tokens presented across organizations are rejected with HTTP 403.
