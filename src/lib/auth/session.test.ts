import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 0, 1);

describe("session tokens", () => {
  it("verifies a fresh token", () => {
    const token = createSessionToken("admin", SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 1000)).toMatchObject({ sub: "admin" });
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken("admin", SECRET, NOW, 60);
    expect(verifySessionToken(token, SECRET, NOW + 61_000)).toBeNull();
  });

  it("rejects a different secret or tampered payload", () => {
    const token = createSessionToken("admin", SECRET, NOW);
    expect(verifySessionToken(token, "t".repeat(40), NOW)).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "root", iat: 0, exp: 9e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects garbage", () => {
    for (const bad of [undefined, "", "a.b.c", "nodot", "x".repeat(2000)]) {
      expect(verifySessionToken(bad, SECRET, NOW)).toBeNull();
    }
  });
});

describe("session epoch claim", () => {
  it("round-trips the epoch and omits it when empty", () => {
    const withEpoch = verifySessionToken(createSessionToken("admin", SECRET, NOW, 60, "abcd"), SECRET, NOW);
    expect(withEpoch?.sep).toBe("abcd");
    const without = verifySessionToken(createSessionToken("admin", SECRET, NOW, 60), SECRET, NOW);
    expect(without).not.toHaveProperty("sep");
  });
});
