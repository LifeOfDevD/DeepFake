# Operational Runbooks & Site Reliability Engineering (SRE)

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  

---

## 1. Operations Overview

This directory provides operational procedures, emergency runbooks, disaster recovery strategies, and key management guides for operating the Digital Impersonation Response Desk in staging, pilot, and production environments.

## Operations Guides

1. **[Operational Runbooks Summary](runbooks.md):** Consolidated operational procedures for emergency kill switch activation, database backup and restoration, key rotation, and version rollback.
2. **Detailed Repository Runbooks:**
   - [`Operational Runbooks Guide`](../operational-runbooks.md): Day-to-day administrative and diagnostic tasks.
   - [`Backup and Recovery Runbook`](../backup-and-recovery.md): SQLite snapshot and WAL recovery procedures.
   - [`Disaster Recovery Plan`](../disaster-recovery-plan.md): RPO and RTO recovery objectives.
   - [`Key Rotation Procedure`](../key-rotation-procedure.md): Rotating session secrets, HMAC tokens, and KMS keys.
   - [`Deployment Rollback Runbook`](../deployment-rollback.md): Safe rollback procedures for container releases.
