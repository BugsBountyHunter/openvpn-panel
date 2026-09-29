import { timingSafeEqual } from "node:crypto";
import { DEMO_PASSWORD, type PanelConfig } from "../config";
import { verifyPassword } from "./password";
import type { LoginRateLimiter } from "./rate-limit";
import { createSessionToken } from "./session";
import { effectivePasswordHash, readAuthState, sessionEpochFor, type AuthState } from "./state";

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

/** Checks the admin password: the one set in the panel if any, else the env hash (or "demo"). */
export async function checkPassword(
  password: string,
  config: PanelConfig,
  state: AuthState = readAuthState(config.authStatePath),
): Promise<boolean> {
  const hash = effectivePasswordHash(config.adminPasswordHash, state);
  if (hash) return verifyPassword(password, hash);
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
  // Count the attempt before the slow verify so parallel guesses cannot exceed
  // the limit; a correct login clears it again.
  limiter.recordFailure(attempt.ip, now);
  // Read once, before the slow verify, so the session matches what was checked.
  const state = readAuthState(config.authStatePath);
  // Always verify the password, even for a wrong username, to avoid a timing oracle.
  const passwordOk = await checkPassword(attempt.password, config, state);
  const userOk = safeEqual(attempt.username, config.adminUser);
  if (passwordOk && userOk) {
    limiter.recordSuccess(attempt.ip);
    const sessionEpoch = sessionEpochFor(config.adminPasswordHash, state);
    const token = createSessionToken(config.adminUser, config.sessionSecret, now, undefined, sessionEpoch);
    return { ok: true, token };
  }
  return { ok: false, status: 401, error: "Invalid username or password" };
}
