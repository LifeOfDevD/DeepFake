# 15-Minute Technical Evaluation & Operator Demo Guide

**Application:** Digital Impersonation Response Desk  
**Target Audience:** Technical Evaluators, Architects, Security Reviewers, and Engineering Leaders  
**Evaluation Mode:** 100% Offline • Localhost Sandbox • Synthetic Data Only  

---

## 1. Quick Setup (Under 2 Minutes)

Run the following commands in your terminal to set up the local sandbox:

```bash
# 1. Clone & install dependencies
git clone https://github.com/ChiragArora22/DeepFake.git
cd DeepFake
npm ci

# 2. Configure local development environment
cp .env.example .env

# 3. Initialize SQLite database & seed synthetic demo fixtures
npm run seed

# 4. Start local development server
npm run dev
```

Open your browser to: **`http://127.0.0.1:4000`**

---

## 2. The 10-Step Evaluation Journey

### Step 1: Persona Login & Organization Context
1. On the landing screen, notice the active security indicator: **`Controlled Pilot Mode: Active (Dry-Run Only)`**.
2. Authenticate using the pre-seeded Case Manager credentials:
   - **Email:** `priya.nair@apexhealth.example`
   - **Password:** `PriyaPassword123!` (seeded demo credentials)
3. Notice that the organization context is securely bound to **Apex Health Systems** (`org_apex_health_01`).

---

### Step 2: Inspect Active Cases & Statutory Countdown Clocks
1. Navigate to the **Cases** tab.
2. Select the seeded incident: **`case_apex_2026_001`** (*"Synthetic Video - Deepfake Endorsement of Unauthorized Drug"*).
3. Observe the statutory timer:
   - Mapped to **IT Rules 2021 Rule 3(2)(b)** (72-hour mandatory impersonation takedown SLA).
   - Visual countdown tracks elapsed hours and remaining time before statutory breach.

---

### Step 3: Forensic Evidence Vault & SHA-256 Custody
1. Click the **Evidence** tab within the case.
2. Notice the pre-seeded evidence item (`ev_apex_001` - synthetic deepfake video screenshot).
3. Click **View Custody Metadata**:
   - **Streaming SHA-256 Hash:** `c4a88f5d6f1a8e2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b`
   - **MIME Magic-Byte Verified:** `image/png` (validated on wire)
   - **Storage State:** Locked (WORM simulation active; 180-day retention lock)
4. Click **Download Evidence**:
   - Notice the API issues a short-lived HMAC token with a 300-second TTL before streaming the file.

---

### Step 4: Test Legal Hold Deletion Block (HTTP 409)
1. In the evidence modal, click **Apply Legal Hold**.
2. Attempt to delete the evidence file.
3. Observe that the deletion is rejected with **`HTTP 409 Conflict: OBJECT_UNDER_LEGAL_HOLD`**, proving that active legal investigations override deletion requests.

---

### Step 5: Monitoring Signals & Automated Ingestion
1. Navigate to the **Monitoring** tab.
2. Review ingested candidate signals discovered across monitored channels.
3. Inspect the normalized URL: tracking parameters (`utm_*`, `fbclid`) have been stripped, and canonized hostnames are enforced.
4. Promote a candidate signal to confirmed threat status.

---

### Step 6: Platform Playbook Selection
1. Navigate to the **Playbooks** tab.
2. Select the **YouTube Deepfake & Impersonation Grievance Playbook**.
3. Review the statutory grounding:
   - Maps to **Section 66D of the IT Act, 2000** (Cheating by personation).
   - Pre-fills verified grievance officer contact addresses and statutory declaration clauses.

---

### Step 7: Multi-Facet Human Approvals
1. Open the submission drawer for the draft notice.
2. Attempt to dispatch immediately: observe that the action is blocked because multi-facet approvals are pending.
3. Use the header role switcher to switch to **Legal Counsel** (`ananya.deshmukh@apexhealth.example`).
4. Review the legal draft and click **Sign-Off (Legal Facet)**.
5. Switch to **Evidence Specialist** (`rohan.verma@apexhealth.example`) and click **Sign-Off (Evidence Facet)**.

---

### Step 8: Generate Dry-Run Submission Packet
1. Switch back to **Case Manager**.
2. Click **Generate Submission Dossier**.
3. Observe that the status transitions to **`simulated_submitted`**:
   - The full legal grievance notice, timestamped screenshot, and Section 65B forensic certificate are compiled for the operator.
   - **Safety Assertion:** Zero outbound HTTP calls were made to external social media platforms.

---

### Step 9: Verify the Immutable Audit Trail
1. Navigate to the **Audit Ledger** tab.
2. Review the chronological event log:
   - Every action (login, triage transition, evidence upload, legal hold, approvals, simulation) is recorded with timestamp, user ID, tenant ID, and cryptographic event hash.

---

### Step 10: Run the Security Verification Suite
In your terminal, run the automated test and adversarial verification suites:

```bash
# 1. Run all 447 automated tests (100% pass)
npm test

# 2. Run the 11 targeted red-team exploit vectors
npm run test:security
```

All 11 exploit vectors (SQL injection, XSS, BOLA, SSRF, token tampering, and legal hold bypass) will be defeated.
