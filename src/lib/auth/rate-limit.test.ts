import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./rate-limit";

const opts = { windowMs: 60_000, maxPerKey: 3, maxGlobal: 5 };

describe("LoginRateLimiter", () => {
  it("blocks a key after max failures until the window resets", () => {
    const limiter = new LoginRateLimiter(opts);
    for (let i = 0; i < 3; i++) limiter.recordFailure("1.1.1.1", 0);
    expect(limiter.retryAfter("1.1.1.1", 1000)).toBe(59);
    expect(limiter.retryAfter("2.2.2.2", 1000)).toBe(0);
    expect(limiter.retryAfter("1.1.1.1", 60_000)).toBe(0);
  });

  it("applies a global cap across keys", () => {
    const limiter = new LoginRateLimiter(opts);
    ["a", "b", "c", "d", "e"].forEach((k) => limiter.recordFailure(k, 0));
    expect(limiter.retryAfter("fresh", 10)).toBeGreaterThan(0);
  });

  it("clears a key on success", () => {
    const limiter = new LoginRateLimiter(opts);
    limiter.recordFailure("k", 0);
    limiter.recordFailure("k", 0);
    limiter.recordSuccess("k");
    limiter.recordFailure("k", 0);
    expect(limiter.retryAfter("k", 0)).toBe(0);
  });
});
