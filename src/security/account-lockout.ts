export interface LockoutRecord {
  failedAttempts: number;
  lockedUntil: number | null; // epoch ms
  lastAttemptAt: number;
}

export interface LockoutStatus {
  isLocked: boolean;
  remainingSeconds?: number;
  attemptsRemaining?: number;
}

/**
 * Account Lockout and Brute-Force Abuse Protection Service
 * Implements exponential backoff and temporary account lockouts after consecutive failed logins.
 */
export class AccountLockoutService {
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15-minute sliding window

  private static memoryStore: Map<string, LockoutRecord> = new Map();

  private static getKey(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  /**
   * Checks if an account or IP identifier is currently locked out
   */
  public static checkLockout(identifier: string): LockoutStatus {
    const key = this.getKey(identifier);
    const record = this.memoryStore.get(key);

    if (!record) {
      return { isLocked: false, attemptsRemaining: this.MAX_ATTEMPTS };
    }

    const now = Date.now();

    // Check if currently locked
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { isLocked: true, remainingSeconds };
    }

    // Lockout expired or sliding window lapsed
    if (record.lockedUntil && record.lockedUntil <= now) {
      this.memoryStore.delete(key);
      return { isLocked: false, attemptsRemaining: this.MAX_ATTEMPTS };
    }

    if (now - record.lastAttemptAt > this.ATTEMPT_WINDOW_MS) {
      this.memoryStore.delete(key);
      return { isLocked: false, attemptsRemaining: this.MAX_ATTEMPTS };
    }

    const attemptsRemaining = Math.max(0, this.MAX_ATTEMPTS - record.failedAttempts);
    return { isLocked: false, attemptsRemaining };
  }

  /**
   * Records a failed login attempt and trips lockout if threshold exceeded
   */
  public static recordFailedAttempt(identifier: string): LockoutStatus {
    const key = this.getKey(identifier);
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    let attempts = 1;
    if (existing && now - existing.lastAttemptAt <= this.ATTEMPT_WINDOW_MS) {
      attempts = existing.failedAttempts + 1;
    }

    let lockedUntil: number | null = null;
    if (attempts >= this.MAX_ATTEMPTS) {
      lockedUntil = now + this.LOCKOUT_DURATION_MS;
    }

    const record: LockoutRecord = {
      failedAttempts: attempts,
      lockedUntil,
      lastAttemptAt: now
    };

    this.memoryStore.set(key, record);

    if (lockedUntil) {
      const remainingSeconds = Math.ceil(this.LOCKOUT_DURATION_MS / 1000);
      return { isLocked: true, remainingSeconds };
    }

    return {
      isLocked: false,
      attemptsRemaining: Math.max(0, this.MAX_ATTEMPTS - attempts)
    };
  }

  /**
   * Resets failed attempts after a successful login
   */
  public static recordSuccessfulLogin(identifier: string): void {
    const key = this.getKey(identifier);
    this.memoryStore.delete(key);
  }

  /**
   * Manually unlocks an identifier (administrative action)
   */
  public static unlock(identifier: string): void {
    const key = this.getKey(identifier);
    this.memoryStore.delete(key);
  }

  /**
   * Clears all memory state (for test teardowns)
   */
  public static resetAll(): void {
    this.memoryStore.clear();
  }
}
