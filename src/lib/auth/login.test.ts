import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { attemptLogin } from "./login";
import { hashPassword } from "./password";
import { LoginRateLimiter } from "./rate-limit";
import { verifySessionToken } from "./session";

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

  it("accepts the demo password only in demo mode without a hash", async () => {
    const demo = loadConfig({} as unknown as NodeJS.ProcessEnv);
    const ok = await attemptLogin({ username: "admin", password: "demo", ip: "i" }, demo, new LoginRateLimiter());
    expect(ok.ok).toBe(true);
    const live = await liveConfig();
    const no = await attemptLogin({ username: "admin", password: "demo", ip: "i" }, live, new LoginRateLimiter());
    expect(no.ok).toBe(false);
  });
});
