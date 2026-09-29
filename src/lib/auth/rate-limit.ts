/**
 * In-memory fixed-window limiter for failed logins. Limits both per client IP
 * and globally, so rotating source addresses cannot bypass it.
 */

export interface LimiterOptions {
  windowMs: number;
  maxPerKey: number;
  maxGlobal: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export const DEFAULT_LOGIN_LIMITS: LimiterOptions = {
  windowMs: 15 * 60_000,
  maxPerKey: 5,
  maxGlobal: 30,
};

const GLOBAL_KEY = "\u0000global";
const MAX_TRACKED_KEYS = 10_000;

export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly options: LimiterOptions = DEFAULT_LOGIN_LIMITS) {}

  private current(key: string, now: number): Bucket | null {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) return null;
    return bucket;
  }

  /** Returns seconds until the caller may retry, or 0 if allowed. */
  retryAfter(key: string, now: number = Date.now()): number {
    const perKey = this.current(key, now);
    const global = this.current(GLOBAL_KEY, now);
    const blocked = [
      perKey && perKey.count >= this.options.maxPerKey ? perKey.resetAt : 0,
      global && global.count >= this.options.maxGlobal ? global.resetAt : 0,
    ];
    const until = Math.max(...blocked);
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    this.prune(now);
    for (const k of [key, GLOBAL_KEY]) {
      const bucket = this.current(k, now);
      this.buckets.set(
        k,
        bucket ? { count: bucket.count + 1, resetAt: bucket.resetAt } : { count: 1, resetAt: now + this.options.windowMs },
      );
    }
  }

  /**
   * Clears the key and releases the global slot its attempt took. Callers
   * record each attempt as a failure before verifying, so a success undoes
   * that one count; earlier real failures from the key still count globally.
   */
  recordSuccess(key: string, now: number = Date.now()): void {
    this.buckets.delete(key);
    const global = this.current(GLOBAL_KEY, now);
    if (global && global.count > 0) {
      this.buckets.set(GLOBAL_KEY, { count: global.count - 1, resetAt: global.resetAt });
    }
  }

  private prune(now: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) return;
    for (const [k, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(k);
    }
  }
}

const holder = globalThis as unknown as { __loginLimiter?: LoginRateLimiter };

export function getLoginLimiter(): LoginRateLimiter {
  if (!holder.__loginLimiter) holder.__loginLimiter = new LoginRateLimiter();
  return holder.__loginLimiter;
}
