import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { attemptLogin } from "./login";
import { hashPassword } from "./password";
import { DEFAULT_LOGIN_LIMITS, LoginRateLimiter } from "./rate-limit";
import { verifySessionToken } from "./session";
import { isSessionCurrent, readAuthState, sessionEpochFor, writeAuthState } from "./state";

const SECRET = "k".repeat(32);

async function liveConfig() {
  return loadConfig({
    PANEL_MODE: "live",
    ADMIN_USER: "admin",
    ADMIN_PASSWORD_HASH: await hashPassword("the-right-password"),
    SESSION_SECRET: SECRET,
  } as unknown as NodeJS.ProcessEnv);
}

describe("attemptLogin", () => {
  it("issues a session for correct credentials", async () => {
    const result = await attemptLogin(
      { username: "admin", password: "the-right-password", ip: "10.8.0.2" },
      await liveConfig(),
      new LoginRateLimiter(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(verifySessionToken(result.token, SECRET)?.sub).toBe("admin");
  });

  it("rejects wrong user or password", async () => {
    const config = await liveConfig();
    const limiter = new LoginRateLimiter();
    const wrongUser = await attemptLogin({ username: "root", password: "the-right-password", ip: "x" }, config, limiter);
    const wrongPass = await attemptLogin({ username: "admin", password: "nope", ip: "x" }, config, limiter);
    expect(wrongUser).toMatchObject({ ok: false, status: 401 });
    expect(wrongPass).toMatchObject({ ok: false, status: 401 });
  });

  it("rate limits repeated failures, even with the right password", async () => {
    const config = await liveConfig();
    const limiter = new LoginRateLimiter({ windowMs: 60_000, maxPerKey: 2, maxGlobal: 100 });
    await attemptLogin({ username: "admin", password: "a", ip: "ip" }, config, limiter);
    await attemptLogin({ username: "admin", password: "b", ip: "ip" }, config, limiter);
    const blocked = await attemptLogin({ username: "admin", password: "the-right-password", ip: "ip" }, config, limiter);
    expect(blocked).toMatchObject({ ok: false, status: 429 });
  });

  it("caps parallel failures at the per-IP limit", async () => {
    const config = await liveConfig();
    const limiter = new LoginRateLimiter();
    const attempts = Array.from({ length: 10 }, (_, i) =>
      attemptLogin({ username: "admin", password: `wrong-${i}`, ip: "10.8.0.9" }, config, limiter),
    );
    const statuses = (await Promise.all(attempts)).map((r) => (r.ok ? 200 : r.status));
    expect(statuses.filter((s) => s === 401)).toHaveLength(DEFAULT_LOGIN_LIMITS.maxPerKey);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10 - DEFAULT_LOGIN_LIMITS.maxPerKey);
  });

  it("lets a correct login through after failures and clears the per-IP bucket", async () => {
    const config = await liveConfig();
    const limiter = new LoginRateLimiter();
    const ip = "10.8.0.10";
    const wrong = () => attemptLogin({ username: "admin", password: "nope", ip }, config, limiter);
    for (let i = 0; i < DEFAULT_LOGIN_LIMITS.maxPerKey - 1; i++) {
      expect(await wrong()).toMatchObject({ ok: false, status: 401 });
    }
    const ok = await attemptLogin({ username: "admin", password: "the-right-password", ip }, config, limiter);
    expect(ok.ok).toBe(true);
    expect(limiter.retryAfter(ip)).toBe(0);
    // A full fresh budget: maxPerKey more failures are 401 before the next is 429.
    for (let i = 0; i < DEFAULT_LOGIN_LIMITS.maxPerKey; i++) {
      expect(await wrong()).toMatchObject({ ok: false, status: 401 });
    }
    expect(await wrong()).toMatchObject({ ok: false, status: 429 });
  });

  it("accepts the demo password only in demo mode without a hash", async () => {
    const demo = loadConfig({} as unknown as NodeJS.ProcessEnv);
    const ok = await attemptLogin({ username: "admin", password: "demo", ip: "i" }, demo, new LoginRateLimiter());
    expect(ok.ok).toBe(true);
    const live = await liveConfig();
    const no = await attemptLogin({ username: "admin", password: "demo", ip: "i" }, live, new LoginRateLimiter());
    expect(no.ok).toBe(false);
  });
});

describe("attemptLogin after a revocation", () => {
  it("issues sessions in the current epoch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "login-"));
    try {
      const config = { ...(await liveConfig()), authStatePath: join(dir, "auth.json") };
      await writeAuthState(config.authStatePath, { passwordHash: null, baseHash: null, sessionEpoch: "0123456789abcdef" });
      const result = await attemptLogin(
        { username: "admin", password: "the-right-password", ip: "10.8.0.2" },
        config,
        new LoginRateLimiter(),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const session = verifySessionToken(result.token, SECRET);
      const state = readAuthState(config.authStatePath);
      expect(session?.sep).toBe(sessionEpochFor(config.adminPasswordHash, state));
      expect(isSessionCurrent(session!, config.adminPasswordHash, state)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
