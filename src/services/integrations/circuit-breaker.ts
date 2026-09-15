import Database from 'better-sqlite3';
import { getDatabase } from '../../db/connection.js';
import { CircuitState, ProviderCircuitState, ProviderHealth } from '../../domain/types.js';

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures before tripping to open (default 5)
  cooldownPeriodMs: number; // cooldown before transitioning from open to half_open (default 60000ms)
  recoveryThreshold: number; // consecutive successes in half_open before closing (default 2)
  maxRetries: number; // max retry attempts per operation (default 3)
  rateLimitPerMinute: number; // max requests per minute (default 60)
}

export class CircuitBreaker {
  private db: Database.Database;
  private config: CircuitBreakerConfig;
  private rateLimitWindow: Map<string, number[]> = new Map(); // connectionId -> timestamp array

  constructor(db?: Database.Database, config?: Partial<CircuitBreakerConfig>) {
    this.db = db || getDatabase();
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      cooldownPeriodMs: config?.cooldownPeriodMs ?? 60000,
      recoveryThreshold: config?.recoveryThreshold ?? 2,
      maxRetries: config?.maxRetries ?? 3,
      rateLimitPerMinute: config?.rateLimitPerMinute ?? 60
    };
  }

  /**
   * Retrieves or initializes the persistent circuit state for a connection
   */
  public getState(connectionId: string): ProviderCircuitState {
    let row = this.db.prepare(`
      SELECT * FROM provider_circuit_states WHERE connection_id = ?
    `).get(connectionId) as any;

    if (!row) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO provider_circuit_states (
          connection_id, circuit_state, failure_count, consecutive_successes,
          total_requests, total_failures, total_retries, updated_at
        ) VALUES (?, 'closed', 0, 0, 0, 0, 0, ?)
      `).run(connectionId, now);

      row = this.db.prepare(`
        SELECT * FROM provider_circuit_states WHERE connection_id = ?
      `).get(connectionId) as any;
    }

    return {
      connection_id: row.connection_id,
      circuit_state: row.circuit_state as CircuitState,
      failure_count: row.failure_count || 0,
      consecutive_successes: row.consecutive_successes || 0,
      last_failure_at: row.last_failure_at,
      last_failure_reason: row.last_failure_reason,
      opened_at: row.opened_at,
      cooldown_until: row.cooldown_until,
      total_requests: row.total_requests || 0,
      total_failures: row.total_failures || 0,
      total_retries: row.total_retries || 0,
      updated_at: row.updated_at
    };
  }

  /**
   * Checks rate limiting for connection
   */
  public checkRateLimit(connectionId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = now - 60000;
    const timestamps = (this.rateLimitWindow.get(connectionId) || []).filter((t) => t > windowStart);

    if (timestamps.length >= this.config.rateLimitPerMinute) {
      this.rateLimitWindow.set(connectionId, timestamps);
      return { allowed: false, remaining: 0 };
    }

    timestamps.push(now);
    this.rateLimitWindow.set(connectionId, timestamps);
    return {
      allowed: true,
      remaining: this.config.rateLimitPerMinute - timestamps.length
    };
  }

  /**
   * Evaluates circuit readiness before executing an operation.
   * Auto-transitions from `open` to `half_open` when cooldown has elapsed.
   */
  public canExecute(connectionId: string): { canExecute: boolean; state: CircuitState; reason?: string } {
    const state = this.getState(connectionId);
    const now = Date.now();

    if (state.circuit_state === 'closed') {
      const rl = this.checkRateLimit(connectionId);
      if (!rl.allowed) {
        return {
          canExecute: false,
          state: 'closed',
          reason: `RATE_LIMIT_EXCEEDED: Maximum of ${this.config.rateLimitPerMinute} requests per minute reached`
        };
      }
      return { canExecute: true, state: 'closed' };
    }

    if (state.circuit_state === 'open') {
      const cooldownUntil = state.cooldown_until ? new Date(state.cooldown_until).getTime() : 0;
      if (now >= cooldownUntil) {
        // Transition to half_open to probe recovery
        this.updateState(connectionId, {
          circuit_state: 'half_open',
          consecutive_successes: 0
        });
        return { canExecute: true, state: 'half_open' };
      }

      const remainingSec = Math.ceil((cooldownUntil - now) / 1000);
      return {
        canExecute: false,
        state: 'open',
        reason: `CIRCUIT_OPEN: Circuit breaker is open. Cooldown active for ${remainingSec} more seconds. Last failure: ${state.last_failure_reason || 'Repeated errors'}`
      };
    }

    if (state.circuit_state === 'half_open') {
      // In half_open, allow single probe requests
      return { canExecute: true, state: 'half_open' };
    }

    return { canExecute: true, state: 'closed' };
  }

  /**
   * Executes an asynchronous external provider call with bounded exponential retries and circuit updates
   */
  public async execute<T>(
    connectionId: string,
    operation: () => Promise<T>,
    operationName: string = 'provider_call'
  ): Promise<T> {
    const readiness = this.canExecute(connectionId);
    if (!readiness.canExecute) {
      throw new Error(`CIRCUIT_BREAKER_REJECTED: Cannot execute ${operationName}: ${readiness.reason}`);
    }

    let attempt = 0;
    let lastError: any = null;

    while (attempt <= this.config.maxRetries) {
      try {
        const result = await operation();
        this.recordSuccess(connectionId);
        return result;
      } catch (err: any) {
        lastError = err;
        attempt++;

        if (attempt <= this.config.maxRetries) {
          // Record retry
          this.incrementRetryCount(connectionId);
          const backoffMs = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 1000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries exhausted
    this.recordFailure(connectionId, lastError?.message || 'Unknown provider error');
    throw lastError;
  }

  /**
   * Records a successful execution and transitions half_open -> closed if threshold reached
   */
  public recordSuccess(connectionId: string): void {
    const current = this.getState(connectionId);

    if (current.circuit_state === 'half_open') {
      const consecutive = current.consecutive_successes + 1;
      if (consecutive >= this.config.recoveryThreshold) {
        // Close the circuit
        this.updateState(connectionId, {
          circuit_state: 'closed',
          failure_count: 0,
          consecutive_successes: 0,
          cooldown_until: null,
          opened_at: null,
          total_requests: current.total_requests + 1
        });
        return;
      } else {
        this.updateState(connectionId, {
          consecutive_successes: consecutive,
          total_requests: current.total_requests + 1
        });
        return;
      }
    }

    // Standard closed success
    this.updateState(connectionId, {
      failure_count: 0,
      total_requests: current.total_requests + 1
    });
  }

  /**
   * Records a failure and transitions closed/half_open -> open if threshold reached
   */
  public recordFailure(connectionId: string, reason: string): void {
    const current = this.getState(connectionId);
    const now = new Date().toISOString();
    const failures = current.failure_count + 1;

    if (current.circuit_state === 'half_open' || failures >= this.config.failureThreshold) {
      // Trip circuit to open
      const cooldownUntil = new Date(Date.now() + this.config.cooldownPeriodMs).toISOString();
      this.updateState(connectionId, {
        circuit_state: 'open',
        failure_count: failures,
        consecutive_successes: 0,
        last_failure_at: now,
        last_failure_reason: reason,
        opened_at: now,
        cooldown_until: cooldownUntil,
        total_requests: current.total_requests + 1,
        total_failures: current.total_failures + 1
      });
    } else {
      this.updateState(connectionId, {
        failure_count: failures,
        last_failure_at: now,
        last_failure_reason: reason,
        total_requests: current.total_requests + 1,
        total_failures: current.total_failures + 1
      });
    }
  }

  /**
   * Increments retry count for telemetry
   */
  private incrementRetryCount(connectionId: string): void {
    this.db.prepare(`
      UPDATE provider_circuit_states SET total_retries = total_retries + 1 WHERE connection_id = ?
    `).run(connectionId);
  }

  /**
   * Helper to update circuit state in SQLite
   */
  private updateState(connectionId: string, updates: Partial<ProviderCircuitState>): void {
    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    for (const [k, v] of Object.entries(updates)) {
      if (k !== 'connection_id' && k !== 'updated_at') {
        fields.push(`${k} = ?`);
        values.push(v);
      }
    }

    values.push(connectionId);
    this.db.prepare(`
      UPDATE provider_circuit_states SET ${fields.join(', ')} WHERE connection_id = ?
    `).run(...values);
  }

  /**
   * Exposes observable health metrics for a connection
   */
  public getHealth(connectionId: string): ProviderHealth {
    const state = this.getState(connectionId);

    let status: 'healthy' | 'degraded' | 'circuit_open' | 'disconnected' = 'healthy';
    if (state.circuit_state === 'open') {
      status = 'circuit_open';
    } else if (state.failure_count > 0 || state.circuit_state === 'half_open') {
      status = 'degraded';
    }

    const now = Date.now();
    const timestamps = (this.rateLimitWindow.get(connectionId) || []).filter((t) => t > now - 60000);

    return {
      connection_id: connectionId,
      status,
      circuit_state: state.circuit_state,
      request_count: state.total_requests,
      failure_count: state.total_failures,
      retry_count: state.total_retries,
      rate_limit_remaining: Math.max(0, this.config.rateLimitPerMinute - timestamps.length),
      last_successful_poll: state.circuit_state === 'closed' ? state.updated_at : null,
      last_failure: state.last_failure_at,
      last_failure_reason: state.last_failure_reason
    };
  }

  /**
   * Resets circuit state manually (e.g. administrator override)
   */
  public reset(connectionId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE provider_circuit_states SET
        circuit_state = 'closed',
        failure_count = 0,
        consecutive_successes = 0,
        opened_at = NULL,
        cooldown_until = NULL,
        updated_at = ?
      WHERE connection_id = ?
    `).run(now, connectionId);
  }
}
