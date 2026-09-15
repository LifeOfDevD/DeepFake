import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { CircuitBreaker } from '../../src/services/integrations/circuit-breaker.js';

describe('Unit: Circuit Breaker & Rate Limiter', () => {
  let db: Database.Database;
  let cb: CircuitBreaker;
  const connId = 'conn_test_cb_01';
  const orgId = 'org_test_cb_01';
  const userId = 'usr_test_cb_01';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'CB Org', 'cb-org', 'healthcare', 'IN-DL', 'cb@example.in')
    `).run(orgId);

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES (?, 'cb@example.in', 'CB User', 'hash123')
    `).run(userId);

    db.prepare(`
      INSERT INTO provider_connections (id, organization_id, provider_type, status, scopes, created_by_user_id)
      VALUES (?, ?, 'youtube', 'connected', '[]', ?)
    `).run(connId, orgId, userId);

    cb = new CircuitBreaker(db, {
      failureThreshold: 3,
      cooldownPeriodMs: 500, // short cooldown for testing
      recoveryThreshold: 2,
      maxRetries: 1,
      rateLimitPerMinute: 5
    });
  });

  afterEach(() => {
    db.close();
  });

  it('starts in closed state and successfully executes calls', async () => {
    const health = cb.getHealth(connId);
    expect(health.circuit_state).toBe('closed');
    expect(health.status).toBe('healthy');

    let executed = false;
    const result = await cb.execute(connId, async () => {
      executed = true;
      return 'success_payload';
    });

    expect(executed).toBe(true);
    expect(result).toBe('success_payload');

    const updated = cb.getState(connId);
    expect(updated.total_requests).toBe(1);
    expect(updated.failure_count).toBe(0);
  });

  it('accumulates failures and trips from closed to open upon hitting failure threshold', async () => {
    // 3 failures needed to trip
    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(connId, async () => {
          throw new Error(`Simulated upstream failure ${i + 1}`);
        })
      ).rejects.toThrow();
    }

    const state = cb.getState(connId);
    expect(state.circuit_state).toBe('open');
    expect(state.failure_count).toBe(3);
    expect(state.opened_at).toBeDefined();
    expect(state.cooldown_until).toBeDefined();

    const health = cb.getHealth(connId);
    expect(health.status).toBe('circuit_open');

    // Immediate subsequent call must be rejected without calling operation
    let operationCalled = false;
    await expect(
      cb.execute(connId, async () => {
        operationCalled = true;
        return 'should_not_run';
      })
    ).rejects.toThrow(/CIRCUIT_BREAKER_REJECTED/);

    expect(operationCalled).toBe(false);
  });

  it('recovers from open to half_open after cooldown, then closes on recovery threshold', async () => {
    // 1. Trip circuit to open
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(connId, async () => { throw new Error('fail'); });
      } catch {}
    }
    expect(cb.getState(connId).circuit_state).toBe('open');

    // 2. Wait for cooldown to expire (500ms)
    await new Promise((r) => setTimeout(r, 550));

    // 3. First execution in half_open succeeds
    const res1 = await cb.execute(connId, async () => 'probe_1');
    expect(res1).toBe('probe_1');
    expect(cb.getState(connId).circuit_state).toBe('half_open');
    expect(cb.getState(connId).consecutive_successes).toBe(1);

    // 4. Second execution in half_open succeeds -> closes circuit
    const res2 = await cb.execute(connId, async () => 'probe_2');
    expect(res2).toBe('probe_2');
    expect(cb.getState(connId).circuit_state).toBe('closed');
    expect(cb.getState(connId).failure_count).toBe(0);
  });

  it('enforces rate limits per minute', () => {
    // rateLimitPerMinute is 5
    for (let i = 0; i < 5; i++) {
      const rl = cb.checkRateLimit(connId);
      expect(rl.allowed).toBe(true);
    }

    // 6th should be rejected
    const rl6 = cb.checkRateLimit(connId);
    expect(rl6.allowed).toBe(false);
    expect(rl6.remaining).toBe(0);
  });

  it('resets circuit state when requested by admin', () => {
    // Trip to open
    for (let i = 0; i < 3; i++) {
      cb.recordFailure(connId, 'err');
    }
    expect(cb.getState(connId).circuit_state).toBe('open');

    // Reset
    cb.reset(connId);
    expect(cb.getState(connId).circuit_state).toBe('closed');
    expect(cb.getState(connId).failure_count).toBe(0);
  });
});
