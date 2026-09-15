# Local Dry-Run Billing & Simulated Invoicing

## 1. Safety Architecture: Zero Real Billing

To prevent accidental financial transactions during pilot evaluations, the **Digital Impersonation Response Desk** utilizes a hermetic `LocalDryRunBillingProvider`.

> [!IMPORTANT]
> **Zero Live Billing Guarantee**:
> - The system does **not** connect to Stripe, Razorpay, BillDesk, or any payment gateway.
> - `ENABLE_LIVE_BILLING` is locked to `false`. Attempting to toggle live billing causes immediate fatal crash on startup.
> - All billing calculations, customer profiles, subscriptions, and invoices are generated locally in-memory and in SQLite.

---

## 2. Dry-Run Invoicing Engine

The billing engine calculates realistic enterprise SaaS invoices based on the organization's plan tier and recorded metered usage.

### 2.1 Invoice Structure & Indian GST Compliance

1. **Base Subscription**: Flat monthly rate for the active tier (e.g. ₹0 for Pilot, ₹49,000 for Professional, ₹1,49,000 for Enterprise).
2. **Itemized Overages**:
   - Excess Active Cases (above plan allowance).
   - Excess Quota Storage (gigabytes consumed above storage cap).
   - Excess Platform Dispatches (simulated submissions above allowance).
3. **Goods & Services Tax (18% GST)**:
   - In compliance with Indian SaaS tax regulations, standard 18% GST is calculated on total subtotal:
     $$\text{GST Amount (INR)} = \text{round}(\text{Subtotal INR} \times 0.18)$$
     $$\text{Total Invoice Amount (INR)} = \text{Subtotal INR} + \text{GST Amount (INR)}$$
4. **Permanent Simulation Watermark**:
   - Every invoice object carries an immutable disclaimer:
     `DRY-RUN SIMULATION ONLY - NO PAYMENT PROCESSED - ZERO COMMERCIAL CHARGES`

---

## 3. Sample Simulated Invoice Preview (`InvoicePreview`)

```json
{
  "invoiceNumber": "INV-SIM-202609-F3A8C2B1",
  "organizationId": "org_apex_health_01",
  "organizationName": "Apex Healthcare Systems",
  "periodStart": "2026-09-01T00:00:00Z",
  "periodEnd": "2026-09-30T23:59:59Z",
  "planTier": "professional",
  "subtotalInr": 51500,
  "gstInr": 9270,
  "totalInr": 60770,
  "lineItems": [
    {
      "description": "Professional Incident Response Subscription (Base Tier)",
      "quantity": 1,
      "unitPriceInr": 49000,
      "amountInr": 49000,
      "isOverage": false
    },
    {
      "description": "Additional Cases (5 over plan limit of 100)",
      "quantity": 5,
      "unitPriceInr": 500,
      "amountInr": 2500,
      "isOverage": true
    }
  ],
  "overageWarnings": [
    "Exceeded case limit by 5 cases."
  ],
  "mode": "DRY_RUN_SIMULATION_ONLY",
  "watermark": "DRY-RUN SIMULATION ONLY - NO PAYMENT PROCESSED - ZERO COMMERCIAL CHARGES",
  "generatedAt": "2026-09-12T17:00:00.000Z"
}
```

---

## 4. Billing API Endpoints

### 4.1 Plan Catalog
```http
GET /api/billing/plans
Authorization: Bearer <user_token>
```
Returns list of available tiers, monthly INR pricing, limits, and overage schedules.

### 4.2 Customer & Subscription Profile
```http
GET /api/billing/customer
Authorization: Bearer <user_token>
```
Returns deterministic customer record (`CUST-SIM-...`) mapped to the organization.

```http
GET /api/billing/subscription
Authorization: Bearer <user_token>
```
Returns deterministic subscription object (`SUB-SIM-...`) with period start/end dates.

### 4.3 Invoice Preview
```http
GET /api/billing/invoices/preview
Authorization: Bearer <user_token>
```
Generates on-the-fly invoice preview aggregating current month usage.

### 4.4 Simulate Overage
```http
POST /api/billing/simulate-overage
Content-Type: application/json
Authorization: Bearer <user_token>

{
  "metric": "case_created",
  "quantity": 10
}
```
Allows operators to record synthetic overage events to demonstrate invoice calculations.
