import { createLogger } from "../../config/logger.js";

const log = createLogger("LoginRateLimiter");

/** Timestamps of failed login attempts for a single tenant */
interface TenantAttempts {
  failures: number[];
}

/**
 * In-memory rate limiter for tenant login attempts.
 * Uses a sliding window to track failed attempts per tenant_id.
 *
 * - Default: 5 failed attempts per 15-minute window
 * - Lazy cleanup on access to prevent memory leaks
 * - Periodic cleanup via interval for tenants that stop attempting
 *
 * Resets on server restart (acceptable for single-deploy).
 */
export class LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly attempts: Map<string, TenantAttempts> = new Map();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;

    // Periodic cleanup every 5 minutes to remove stale entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if a tenant login attempt should be allowed.
   * Prunes expired entries from the sliding window before checking.
   * @returns true if allowed, false if rate limited
   */
  isAllowed(tenantId: string): boolean {
    this.pruneExpired(tenantId);
    const record = this.attempts.get(tenantId);
    if (!record) return true;
    return record.failures.length < this.maxAttempts;
  }

  /**
   * Record a failed login attempt for a tenant.
   * Adds the current timestamp to the sliding window.
   */
  recordFailure(tenantId: string): void {
    this.pruneExpired(tenantId);
    let record = this.attempts.get(tenantId);
    if (!record) {
      record = { failures: [] };
      this.attempts.set(tenantId, record);
    }
    record.failures.push(Date.now());

    if (record.failures.length >= this.maxAttempts) {
      log.warn(
        {
          tenantId,
          attempts: record.failures.length,
          maxAttempts: this.maxAttempts,
        },
        "Tenant login rate limit reached",
      );
    }
  }

  /**
   * Reset attempts for a tenant (called on successful login).
   * Clears all tracked failures for this tenant_id.
   */
  reset(tenantId: string): void {
    this.attempts.delete(tenantId);
  }

  /**
   * Get remaining seconds until the earliest failure in the window expires.
   * Used for the Retry-After header value.
   * @returns seconds until the window allows a new attempt, or 0 if not rate limited
   */
  getRetryAfterSeconds(tenantId: string): number {
    this.pruneExpired(tenantId);
    const record = this.attempts.get(tenantId);
    if (!record || record.failures.length < this.maxAttempts) return 0;

    // The oldest failure in the current window determines when the window slides open
    const oldestFailure = record.failures[0];
    const expiresAt = oldestFailure + this.windowMs;
    const remainingMs = expiresAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  /**
   * Remove expired failure timestamps from a tenant's sliding window.
   * Called lazily on each access to keep the window accurate.
   */
  private pruneExpired(tenantId: string): void {
    const record = this.attempts.get(tenantId);
    if (!record) return;

    const cutoff = Date.now() - this.windowMs;
    record.failures = record.failures.filter((ts) => ts > cutoff);

    // Remove entry entirely if no failures remain
    if (record.failures.length === 0) {
      this.attempts.delete(tenantId);
    }
  }

  /**
   * Periodic cleanup: removes all entries with only expired timestamps.
   * Prevents memory leaks when many tenants attempt login and never succeed.
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [tenantId, record] of this.attempts) {
      record.failures = record.failures.filter((ts) => ts > cutoff);
      if (record.failures.length === 0) {
        this.attempts.delete(tenantId);
      }
    }
  }

  /**
   * Stop the periodic cleanup interval (for graceful shutdown).
   */
  dispose(): void {
    clearInterval(this.cleanupInterval);
  }
}
