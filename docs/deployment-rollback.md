# Deployment and Rollback Runbook

## Scope and Principles
This runbook establishes deterministic, zero-data-loss procedures for deploying new releases and executing rapid rollbacks in the event of production failure.

---

## 1. Production Deployment Workflow

### Pre-Deployment Checklist
- [ ] Automated test suite passed: `npm test` (All unit, integration, and security tests green).
- [ ] TypeScript compilation verified: `npm run build` (Exit code 0).
- [ ] Database backup executed immediately prior to deployment:
  ```bash
  npm run create-backup
  ```
- [ ] New environment variables validated against `.env.production.example`.
- [ ] Change window approved by authorized release manager.

### Deployment Execution (Blue/Green or Rolling)
1. **Build and Tag Production Container**:
   ```bash
   docker build -t digital-impersonation-response-desk:v1.0.1 .
   ```
2. **Execute Database Migrations**:
   ```bash
   docker run --rm --env-file /etc/response-desk/.env.production \
     -v response_desk_prod_data:/app/data \
     digital-impersonation-response-desk:v1.0.1 node dist/src/db/migrate.js
   ```
3. **Verify Migration Status**:
   Confirm that all migrations have been applied without errors.
4. **Deploy Updated Container**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --no-deps response-desk-app
   ```
5. **Post-Deployment Verification**:
   - Query readiness probe:
     ```bash
     curl -f https://desk.example.com/healthz/ready
     ```
   - Verify Prometheus metrics endpoint:
     ```bash
     curl -f https://desk.example.com/healthz/metrics
     ```
   - Monitor error rates in application logs for 15 minutes.

---

## 2. Emergency Rollback Procedures

If any of the following triggers occur within 30 minutes of deployment:
- HTTP 5xx error rate exceeds 0.5%
- `/healthz/ready` probe fails
- Worker heartbeats stop updating
- Unhandled database locks or crashes occur

### Rollback Procedure:
1. **Halt Incoming External Traffic**:
   Arm the emergency integration kill switch:
   ```bash
   curl -X POST https://desk.example.com/api/integrations/kill-switch \
     -H "Content-Type: application/json" \
     -d '{"active": true, "reason": "Deployment Rollback in Progress"}'
   ```

2. **Revert Container to Previous Stable Tag**:
   ```bash
   docker-compose -f docker-compose.prod.yml down
   docker tag digital-impersonation-response-desk:v1.0.0 digital-impersonation-response-desk:production
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Database Rollback Assessment**:
   - If the new release did NOT modify the database schema: Container rollback is sufficient.
   - If the new release applied schema migrations that introduced breaking changes:
     Restore the pre-deployment database backup created during step 1 of the deployment checklist.

4. **Verify Rollback Health**:
   ```bash
   curl -f http://127.0.0.1:4000/healthz/ready
   ```

5. **Disarm Kill Switch**:
   ```bash
   curl -X POST https://desk.example.com/api/integrations/kill-switch \
     -H "Content-Type: application/json" \
     -d '{"active": false, "reason": "Rollback Complete - Stable State Restored"}'
   ```
