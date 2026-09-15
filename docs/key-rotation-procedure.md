# Master Encryption Key Rotation Procedure

## Scope and Objectives
This runbook defines the operational protocol for rotating the `ENCRYPTION_MASTER_KEY` used to secure external provider credentials (OAuth access and refresh tokens) at rest via AES-256-GCM. The procedure guarantees zero downtime and avoids rendering historical encrypted data undecryptable.

---

## Key Hierarchy and Lifecycle

| Key Role | Env Variable | Purpose | Rotation Cadence |
| :--- | :--- | :--- | :--- |
| **Primary Active Key** | `ENCRYPTION_MASTER_KEY` | Encrypts all newly ingested tokens. First candidate key during decryption. | 90 Days |
| **Secondary Fallback Keys** | `ENCRYPTION_FALLBACK_KEYS` | Comma-separated list of previous master keys. Progressively attempted if primary key fails tag check. | Retained for 30 days post-rotation |
| **Session Secret** | `SESSION_SECRET` | Signs user sessions and download tokens. Independent lifecycle. | 180 Days |

---

## Step-by-Step Zero-Downtime Rotation

### Phase 1: Preparation
1. Generate a new cryptographically random 32-byte key:
   ```bash
   openssl rand -hex 32
   ```
2. Retrieve the existing active key from production secrets manager:
   ```bash
   OLD_KEY=$(get_current_secret ENCRYPTION_MASTER_KEY)
   ```

### Phase 2: Dual-Key Staging
1. Set the new key as `ENCRYPTION_MASTER_KEY`.
2. Add the previous key to `ENCRYPTION_FALLBACK_KEYS`:
   ```bash
   ENCRYPTION_MASTER_KEY="<NEW_KEY>"
   ENCRYPTION_FALLBACK_KEYS="<OLD_KEY>"
   ```
3. Deploy the application update. The `SecretsManager` service will encrypt all new tokens with the new key while seamlessly decrypting older tokens using the fallback key.

### Phase 3: In-Place Atomic Re-Encryption
1. Execute the database re-encryption migration utility:
   ```bash
   npm run rotate-keys -- --new-key="<NEW_KEY>"
   ```
   Or programmatically invoke:
   ```ts
   SecretsManager.reencryptAllProviderTokens(newKey, db);
   ```
2. Verify the migration report:
   - `connectionsProcessed` matches active connections.
   - `failures == 0`.
   - `errors` list is empty.

### Phase 4: Fallback Key Retirement
1. After 7 days of verified operational stability, remove the old key from `ENCRYPTION_FALLBACK_KEYS`.
2. Permanently destroy the old key in the secrets management vault.

---

## Emergency Key Invalidation Protocol
In the event of a suspected or confirmed compromise of `ENCRYPTION_MASTER_KEY`:
1. **Immediate Halt**: Arm the emergency kill switch:
   ```bash
   curl -X POST https://desk.example.com/api/integrations/kill-switch -H "Content-Type: application/json" -d '{"active": true, "reason": "Emergency Key Compromise"}'
   ```
2. **Provider Revocation**: Call Google OAuth revocation endpoint for all connected accounts to invalidate external access tokens immediately.
3. **Re-key and Purge**: Rotate `ENCRYPTION_MASTER_KEY` and wipe compromised tokens in `provider_connections`.
4. **Re-authorization**: Prompt canary tenant administrators to re-authorize YouTube accounts through the OAuth consent screen.
