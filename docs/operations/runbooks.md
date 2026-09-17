# SRE Operational Runbooks & Emergency Procedures

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  

---

## 1. Runbook 1: Emergency Kill-Switch Activation

**When to Use:** Rogue signal flood, platform API quota exhaustion, suspected webhook poisoning, or system compromise.

### Immediate Activation Command
```bash
# Authenticated administrative POST to trip the kill switch
curl -X POST http://127.0.0.1:4000/api/integrations/kill-switch \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action": "ARM", "reason": "Suspected rogue inbound webhook flooding"}'
```

### Operational Impact
* All inbound webhooks immediately return **`HTTP 503 Service Unavailable: KILL_SWITCH_ACTIVE`**.
* All background worker provider synchronizations pause.
* Read-only dashboard access remains functional for operators.

### Disarm / Recovery Procedure
```bash
curl -X POST http://127.0.0.1:4000/api/integrations/kill-switch \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action": "DISARM", "reason": "Webhook source verified; issue resolved"}'
```

---

## 2. Runbook 2: Database Backup & Point-in-Time Recovery

**Database Engine:** SQLite 3 (better-sqlite3) with WAL mode.

### 2.1 Online Hot Backup
SQLite WAL mode allows zero-downtime hot backups using `better-sqlite3`'s `.backup()` API:
```bash
# Automated backup execution script
npm run backup # Executes BackupService.performBackup()
```
* **Output:** Creates atomic snapshot in `storage/backups/backup-<TIMESTAMP>.sqlite`.
* **Manifest:** Generates `backup-manifest.json` containing the SHA-256 checksum of the database snapshot.

### 2.2 Point-in-Time Recovery
1. Stop application server:
   ```bash
   kill <SERVER_PID>
   ```
2. Validate backup archive integrity against manifest:
   ```bash
   sha256sum -c backup-manifest.json
   ```
3. Restore database snapshot to target directory:
   ```bash
   cp storage/backups/backup-20260916-120000.sqlite data/response_desk.sqlite
   ```
4. Restart application server:
   ```bash
   npm start
   ```

---

## 3. Runbook 3: Secret & Key Rotation

### 3.1 Session Secret & Token Signing Keys
* **Frequency:** 90 days or upon suspected administrative credential compromise.
* **Procedure:**
  1. Generate high-entropy 32-byte secret:
     ```bash
     openssl rand -hex 32
     ```
  2. Set `NEW_SESSION_SECRET` in production secrets manager (AWS Secrets Manager).
  3. Deploy updated environment variable.
  4. Active sessions will expire naturally or be required to re-authenticate.

### 3.2 AES-256 Integration Token Master Key
* Supported in `src/security/secrets-manager.ts` using dual-key fallback:
  1. Add existing key to `ENCRYPTION_FALLBACK_KEYS`.
  2. Set newly generated key as `ENCRYPTION_MASTER_KEY`.
  3. The system decrypts historical tokens using fallback keys and re-encrypts using the new master key.

---

## 4. Runbook 4: Container Deployment & Rollback

### Rollback Criteria
* HTTP 5xx error rate > 0.1% over 5 minutes.
* API P99 latency > 1500ms.
* Unhandled exception detected in logs.

### Immediate Rollback Procedure
```bash
# 1. Route 100% ALB traffic back to previous stable container target group
aws elbv2 modify-listener --listener-arn <ALB_LISTENER_ARN> ...

# 2. Revert ECS Task Definition to previous revision
aws ecs update-service --cluster response-desk-cluster \
  --service desk-service \
  --task-definition response-desk-app:PREVIOUS_REVISION

# 3. Verify health of restored tasks
curl -f http://127.0.0.1:4000/health
```
