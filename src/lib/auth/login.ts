import { timingSafeEqual } from "node:crypto";
import { DEMO_PASSWORD, type PanelConfig } from "../config";
import { verifyPassword } from "./password";
import type { LoginRateLimiter } from "./rate-limit";
import { createSessionToken } from "./session";

export interface LoginAttempt {
  username: string;
  password: string;
  ip: string;
}

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; status: 401 | 429; error: string; retryAfter?: number };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare against self on length mismatch to keep timing uniform.
  return left.length === right.length ? timingSafeEqual(left, right) : !timingSafeEqual(right, right);
}

async function checkPassword(password: string, config: PanelConfig): Promise<boolean> {
  if (config.adminPasswordHash) return verifyPassword(password, config.adminPasswordHash);
  return config.mode === "demo" && safeEqual(password, DEMO_PASSWORD);
}

export async function attemptLogin(
  attempt: LoginAttempt,
  config: PanelConfig,
  limiter: LoginRateLimiter,
  now: number = Date.now(),
): Promise<LoginResult> {
  const retryAfter = limiter.retryAfter(attempt.ip, now);
  if (retryAfter > 0) {
    return { ok: false, status: 429, error: "Too many failed attempts. Try again later.", retryAfter };
  }
  // Always verify the password, even for a wrong username, to avoid a timing oracle.
  const passwordOk = await checkPassword(attempt.password, config);
  const userOk = safeEqual(attempt.username, config.adminUser);
  if (passwordOk && userOk) {
    limiter.recordSuccess(attempt.ip);
    return { ok: true, token: createSessionToken(config.adminUser, config.sessionSecret, now) };
  }
  limiter.recordFailure(attempt.ip, now);
  return { ok: false, status: 401, error: "Invalid username or password" };
}
