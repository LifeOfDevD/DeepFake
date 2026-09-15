import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDatabase, setDatabaseInstance, createDatabaseConnection } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { setConfig, getConfig, validateAndLoadConfig, FatalConfigError } from '../../src/config/env.js';
import { AccountLockoutService } from '../../src/security/account-lockout.js';
import { createRateLimiter } from '../../src/security/rate-limiter.js';
import express from 'express';

describe('Security & Operations: Production Hardening Audit', () => {
  let app: any;
  let testDb: any;
  const originalConfig = { ...getConfig() };

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    setConfig(originalConfig);
    AccountLockoutService.resetAll();
    closeDatabase();
  });

  describe('1. Environment Separation & Secret Fail-Closed Validation', () => {
    it('fails closed when SESSION_SECRET is too short (<32 chars) in production', () => {
      const mockEnv = {
        NODE_ENV: 'production',
        SESSION_SECRET: 'short_secret',
        DOWNLOAD_TOKEN_SECRET: 'a_long_enough_download_token_secret_for_testing_32chars!',
        ENCRYPTION_MASTER_KEY: 'a_long_enough_encryption_key_for_testing_32chars!!'
      };

      expect(() => validateAndLoadConfig(mockEnv)).toThrow(FatalConfigError);
      expect(() => validateAndLoadConfig(mockEnv)).toThrow(/SESSION_SECRET must be explicitly set and be at least 32 characters/);
    });

    it('fails closed when secrets use dev/test prefix in production or staging', () => {
      const mockProdEnv = {
        NODE_ENV: 'production',
        SESSION_SECRET: 'dev_abcdefghijklmnopqrstuvwxyz1234567890',
        DOWNLOAD_TOKEN_SECRET: 'prod_download_token_secret_32chars_long_minimum!',
        ENCRYPTION_MASTER_KEY: 'prod_encryption_master_key_32chars_long_minimum!'
      };

      expect(() => validateAndLoadConfig(mockProdEnv)).toThrow(FatalConfigError);
      expect(() => validateAndLoadConfig(mockProdEnv)).toThrow(/Default development SESSION_SECRET cannot be used in production\/staging/);

      const mockStagingEnv = {
        NODE_ENV: 'staging',
        SESSION_SECRET: 'test_abcdefghijklmnopqrstuvwxyz1234567890',
        DOWNLOAD_TOKEN_SECRET: 'prod_download_token_secret_32chars_long_minimum!',
        ENCRYPTION_MASTER_KEY: 'prod_encryption_master_key_32chars_long_minimum!'
      };

      expect(() => validateAndLoadConfig(mockStagingEnv)).toThrow(FatalConfigError);
      expect(() => validateAndLoadConfig(mockStagingEnv)).toThrow(/Default development SESSION_SECRET cannot be used in production\/staging/);
    });

    it('passes validation when strong production secrets are provided', () => {
      const strongEnv = {
        NODE_ENV: 'production',
        SESSION_SECRET: 'c0b8f419c986dc502f64be8723f5b8a05c6d36e2f1e2e3d4c5b6a7b8c9d0e1f2',
        DOWNLOAD_TOKEN_SECRET: 'f9d3a48e71b2c56a89ef0123456789abcdef0123456789abcdef0123456789ab',
        ENCRYPTION_MASTER_KEY: '8e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f',
        PORT: '4000',
        RATE_LIMIT_ENABLED: 'true'
      };

      const result = validateAndLoadConfig(strongEnv);
      expect(result.nodeEnv).toBe('production');
      expect(result.auth.sessionSecret).toBe(strongEnv.SESSION_SECRET);
      expect(result.security.encryptionMasterKey).toBe(strongEnv.ENCRYPTION_MASTER_KEY);
    });
  });

  describe('2. Account Lockout Protection', () => {
    const testIdentifier = 'brute_force_target@example.com';

    beforeEach(() => {
      AccountLockoutService.unlock(testIdentifier);
    });

    afterAll(() => {
      AccountLockoutService.unlock(testIdentifier);
    });

    it('locks the account after 5 consecutive failed attempts', () => {
      // Attempts 1 to 4 should not lock
      for (let i = 1; i <= 4; i++) {
        const res = AccountLockoutService.recordFailedAttempt(testIdentifier);
        expect(res.isLocked).toBe(false);
        expect(res.attemptsRemaining).toBe(5 - i);
      }

      // 5th attempt locks the account
      const fifthRes = AccountLockoutService.recordFailedAttempt(testIdentifier);
      expect(fifthRes.isLocked).toBe(true);
      expect(fifthRes.remainingSeconds).toBeGreaterThan(0);

      // Subsequent check confirms locked status
      const check = AccountLockoutService.checkLockout(testIdentifier);
      expect(check.isLocked).toBe(true);
      expect(check.remainingSeconds).toBeGreaterThan(0);
    });

    it('resets lockout count upon successful login or administrative unlock', () => {
      // Trip the lock
      for (let i = 0; i < 5; i++) {
        AccountLockoutService.recordFailedAttempt(testIdentifier);
      }
      expect(AccountLockoutService.checkLockout(testIdentifier).isLocked).toBe(true);

      // Unlock
      AccountLockoutService.recordSuccessfulLogin(testIdentifier);
      const check = AccountLockoutService.checkLockout(testIdentifier);
      expect(check.isLocked).toBe(false);
      expect(check.attemptsRemaining).toBe(5);
    });
  });

  describe('3. Application Security Headers', () => {
    it('serves critical defensive HTTP headers on API responses', async () => {
      const res = await request(app).get('/healthz/live');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['x-xss-protection']).toBe('0');
    });

    it('enforces CSP in production mode', async () => {
      const prodConfig = { ...originalConfig, nodeEnv: 'production' as const };
      setConfig(prodConfig);
      const prodApp = createApp();

      const res = await request(prodApp).get('/healthz/live');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");

      // Restore
      setConfig(originalConfig);
    });
  });

  describe('4. Rate Limiting Middleware', () => {
    it('enforces request quotas and sets RateLimit headers and returns 429 when exceeded', async () => {
      const testApp = express();
      const limiter = createRateLimiter({
        windowMs: 10000,
        maxRequests: 2,
        keyGenerator: () => 'test-client-key'
      });

      testApp.use(limiter);
      testApp.get('/test-rate-limit', (_req, res) => {
        res.json({ ok: true });
      });

      // Request 1: success
      const res1 = await request(testApp).get('/test-rate-limit');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-limit']).toBe('2');
      expect(res1.headers['x-ratelimit-remaining']).toBe('1');

      // Request 2: success
      const res2 = await request(testApp).get('/test-rate-limit');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('0');

      // Request 3: 429 Too Many Requests
      const res3 = await request(testApp).get('/test-rate-limit');
      expect(res3.status).toBe(429);
      expect(res3.body.success).toBe(false);
      expect(res3.body.error).toMatch(/RATE_LIMIT_EXCEEDED/);
      expect(res3.headers['retry-after']).toBeDefined();
    });
  });

  describe('5. Observability, Health Probes & Prometheus Exposition', () => {
    it('returns alive status on liveness probe /healthz/live', async () => {
      const res = await request(app).get('/healthz/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
      expect(res.body.timestamp).toBeDefined();
    });

    it('returns readiness status and healthy database checks on /healthz/ready', async () => {
      const res = await request(app).get('/healthz/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.database.healthy).toBe(true);
      expect(res.body.migrations.pendingCount).toBe(0);
    });

    it('exposes standard Prometheus metrics format on /metrics?format=prometheus', async () => {
      // Issue a request to increment counters
      await request(app).get('/healthz/live');

      const res = await request(app).get('/metrics?format=prometheus');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('# HELP response_desk_http_requests_total');
      expect(res.text).toContain('# TYPE response_desk_http_requests_total counter');
      expect(res.text).toContain('response_desk_database_healthy 1');
    });

    it('exposes dependency component status on /healthz/dependencies', async () => {
      const res = await request(app).get('/healthz/dependencies');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dependencies.database.healthy).toBe(true);
      expect(res.body.dependencies.storage.backend).toBeDefined();
    });
  });
});
