import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { BackupService } from '../../src/services/backup-service.js';
import { CircuitBreaker } from '../../src/services/integrations/circuit-breaker.js';
import { ProviderSyncService } from '../../src/services/integrations/provider-sync-service.js';

describe('Resilience & Chaos: Disaster Recovery Failure Injection Suite', () => {
  let app: any;
  let testDb: Database.Database;
  const tempDrDir = path.resolve(process.cwd(), './storage/test_dr_failure_tmp');

  beforeEach(() => {
    if (fs.existsSync(tempDrDir)) {
      fs.rmSync(tempDrDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDrDir, { recursive: true });

    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    runMigrations(testDb);

    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(tempDrDir)) {
      fs.rmSync(tempDrDir, { recursive: true, force: true });
    }
  });

  describe('Scenario 1: Database Unavailability & Recovery', () => {
    it('fails closed and reports 503 when database is closed or corrupted', async () => {
      // 1. Initially healthy
      const initRes = await request(app).get('/healthz/ready');
      expect(initRes.status).toBe(200);
      expect(initRes.body.status).toBe('ready');

      // 2. Inject failure: Close database connection
      closeDatabase();

      // 3. Probes must fail closed with 503
      const failRes = await request(app).get('/healthz/ready');
      expect(failRes.status).toBe(503);
      expect(failRes.body.status).toBe('not_ready');

      // 4. Recover: Re-establish database connection
      const recoveredDb = createDatabaseConnection({ inMemory: true });
      setDatabaseInstance(recoveredDb);
      runMigrations(recoveredDb);

      // 5. Verify system resumes 200 ready state
      const recovRes = await request(app).get('/healthz/ready');
      expect(recovRes.status).toBe(200);
      expect(recovRes.body.status).toBe('ready');
    });
  });

  describe('Scenario 2: Provider Circuit Breaker Trips on Upstream Outage', () => {
    it('accumulates upstream failures, trips to open, and rejects requests fail-fast', async () => {
      testDb.prepare(`
        INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
        VALUES ('org_cb_fail', 'Circuit Fail Org', 'cb-fail-org', 'tech', 'IN-DL', 'admin@fail.in')
      `).run();

      testDb.prepare(`
        INSERT INTO users (id, email, full_name, password_hash)
        VALUES ('usr_cb_admin', 'admin@fail.in', 'Admin Fail', 'pw')
      `).run();

      testDb.prepare(`
        INSERT INTO provider_connections (
          id, organization_id, provider_type, status, account_id, account_name,
          account_email, scopes, is_canary, is_paused, created_by_user_id
        ) VALUES (
          'conn_failing_provider_123', 'org_cb_fail', 'youtube', 'connected', 'UC_fail_123',
          'Failing Channel', 'fail@channel.com', '[]', 1, 0, 'usr_cb_admin'
        )
      `).run();

      const circuitBreaker = new CircuitBreaker(testDb, {
        failureThreshold: 3,
        cooldownPeriodMs: 2000,
        recoveryThreshold: 1,
        maxRetries: 0
      });

      const connectionId = 'conn_failing_provider_123';
      let callCount = 0;

      const failingUpstream = async () => {
        callCount++;
        throw new Error('502 Bad Gateway: Upstream provider unavailable');
      };

      // 1. Initial 3 attempts fail and trip circuit
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(connectionId, failingUpstream)).rejects.toThrow(/502 Bad Gateway/);
      }

      expect(callCount).toBe(3);
      expect(circuitBreaker.getState(connectionId).circuit_state).toBe('open');

      // 2. Subsequent call must be blocked immediately by circuit breaker without executing upstream
      await expect(circuitBreaker.execute(connectionId, failingUpstream)).rejects.toThrow(
        /CIRCUIT_OPEN/
      );
      expect(callCount).toBe(3); // Upstream was NOT invoked
    });
  });

  describe('Scenario 3: Corrupted Backup File Checksum Detection', () => {
    it('detects tampering or byte corruption in backup database and refuses restore', async () => {
      const backupService = new BackupService(testDb);
      const backupResult = await backupService.createBackup(tempDrDir);

      // Verify backup is initially valid
      const initialCheck = backupService.verifyBackup(backupResult.backupDir);
      expect(initialCheck.isValid).toBe(true);

      // Inject corruption: Tamper with database snapshot file
      const dbSnapshotPath = backupResult.databaseBackupPath;
      fs.appendFileSync(dbSnapshotPath, 'CORRUPTED_MALICIOUS_BYTES_INJECTED');

      // Verification must detect hash mismatch
      const corruptedCheck = backupService.verifyBackup(backupResult.backupDir);
      expect(corruptedCheck.isValid).toBe(false);
      expect(corruptedCheck.databaseIntact).toBe(false);
      expect(corruptedCheck.errors[0]).toContain('Database checksum mismatch');

      // Attempted restore to isolated directory must throw error
      const isolatedRestoreDir = path.join(tempDrDir, 'isolated_target');
      await expect(
        backupService.restoreToIsolatedTarget(backupResult.backupDir, isolatedRestoreDir)
      ).rejects.toThrow(/Backup verification failed/);
    });
  });

  describe('Scenario 4: Anti-Overwrite Guard Rejects Restore to Active DB Path', () => {
    it('strictly throws error if restore target is pointed directly at active database path', async () => {
      const backupService = new BackupService(testDb);
      const backupResult = await backupService.createBackup(tempDrDir);

      const activeDataDir = path.resolve(process.cwd(), 'data');

      // Attempting to restore over active data directory must be blocked
      await expect(
        backupService.restoreToIsolatedTarget(backupResult.backupDir, activeDataDir)
      ).rejects.toThrow(/Cannot restore directly into active database directory/);
    });
  });

  describe('Scenario 5: Emergency Kill Switch Instant Cut-off', () => {
    it('immediately halts integration activity when kill switch is armed', async () => {
      ProviderSyncService.setGlobalKillSwitch(true);
      expect(ProviderSyncService.isGlobalKillSwitchActive()).toBe(true);

      // WebSub push returns 503
      const webhookRes = await request(app)
        .post('/api/integrations/youtube/webhook/conn_any_test')
        .set('Content-Type', 'application/atom+xml')
        .send('<feed><entry><title>Test Lookalike</title></entry></feed>');

      expect(webhookRes.status).toBe(503);
      expect(webhookRes.body.error).toContain('KILL_SWITCH_ACTIVE');

      // Disarm kill switch
      ProviderSyncService.setGlobalKillSwitch(false);
      expect(ProviderSyncService.isGlobalKillSwitchActive()).toBe(false);
    });
  });
});
