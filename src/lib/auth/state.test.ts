import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authStatePath,
  effectivePasswordHash,
  EMPTY_AUTH_STATE,
  AuthStateCorruptError,
  isSessionCurrent,
  newSessionEpoch,
  readAuthState,
  sessionEpochFor,
  updateAuthState,
  writeAuthState,
} from "./state";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "auth-state-"));
  path = join(dir, "nested", "auth.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("authStatePath", () => {
  it("lives next to the audit log", () => {
    expect(authStatePath("/var/lib/openvpn-panel/audit.log")).toBe("/var/lib/openvpn-panel/auth.json");
  });
});

describe("readAuthState / writeAuthState", () => {
  it("returns the empty state when the file does not exist", () => {
    expect(readAuthState(path)).toEqual(EMPTY_AUTH_STATE);
  });

  it("round-trips through a 0600 file and sees later writes immediately", async () => {
    const first = { passwordHash: "$argon2id$new", baseHash: "$argon2id$env", sessionEpoch: "aaaa" };
    await writeAuthState(path, first);
    expect(readAuthState(path)).toEqual(first);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    await writeAuthState(path, { ...first, sessionEpoch: "bbbb" });
    expect(readAuthState(path).sessionEpoch).toBe("bbbb");
  });

  it("fails safe on a corrupt file: no override, and every existing session is rejected", () => {
    const file = join(dir, "corrupt.json");
    writeFileSync(file, "{not json");
    const state = readAuthState(file);
    expect(state.passwordHash).toBeNull();
    expect(state.sessionEpoch).toMatch(/^corrupt:[0-9a-f]{16}$/);
    // Stable across reads, so sessions issued after the damage keep working.
    expect(readAuthState(file).sessionEpoch).toBe(state.sessionEpoch);
  });

  it("rejects a schema-invalid file the same way", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ version: 1, passwordHash: 42 }));
    const state = readAuthState(file);
    expect(state.passwordHash).toBeNull();
    expect(state.sessionEpoch).toMatch(/^corrupt:/);
  });

  it("writes atomically without leaving temp files", async () => {
    await writeAuthState(path, EMPTY_AUTH_STATE);
    const entries = readFileSync(path, "utf8");
    expect(JSON.parse(entries)).toMatchObject({ version: 1 });
  });
});

describe("effectivePasswordHash", () => {
  const state = { passwordHash: "$argon2id$ui", baseHash: "$argon2id$env", sessionEpoch: "" };

  it("uses the panel-set hash while the env hash is unchanged", () => {
    expect(effectivePasswordHash("$argon2id$env", state)).toBe("$argon2id$ui");
  });

  it("lets a password reset via the installer (new env hash) win", () => {
    expect(effectivePasswordHash("$argon2id$reset", state)).toBe("$argon2id$reset");
  });

  it("works in demo mode with no env hash", () => {
    expect(effectivePasswordHash(null, { ...state, baseHash: null })).toBe("$argon2id$ui");
    expect(effectivePasswordHash(null, EMPTY_AUTH_STATE)).toBeNull();
  });
});

describe("sessions", () => {
  const payload = { sub: "admin", iat: 1, exp: 2 };
  const env = "$argon2id$env";

  it("accepts only tokens from the current epoch and password", () => {
    const state = { ...EMPTY_AUTH_STATE, sessionEpoch: "cafe" };
    const sep = sessionEpochFor(env, state);
    expect(isSessionCurrent({ ...payload, sep }, env, state)).toBe(true);
    expect(isSessionCurrent(payload, env, state)).toBe(false);
    expect(isSessionCurrent({ ...payload, sep: sessionEpochFor(env, { ...state, sessionEpoch: "beef" }) }, env, state)).toBe(false);
  });

  it("ends every session when the password changes, including via the installer", () => {
    const sep = sessionEpochFor(env, EMPTY_AUTH_STATE);
    expect(isSessionCurrent({ ...payload, sep }, "$argon2id$reset-by-installer", EMPTY_AUTH_STATE)).toBe(false);
    const panelSet = { ...EMPTY_AUTH_STATE, passwordHash: "$argon2id$ui", baseHash: env };
    expect(isSessionCurrent({ ...payload, sep }, env, panelSet)).toBe(false);
  });

  it("never puts the password hash itself in the token", () => {
    expect(sessionEpochFor(env, EMPTY_AUTH_STATE)).not.toContain("argon2");
    expect(sessionEpochFor(env, EMPTY_AUTH_STATE).length).toBeLessThanOrEqual(64);
  });

  it("generates distinct epochs", () => {
    expect(newSessionEpoch()).toMatch(/^[0-9a-f]{16}$/);
    expect(newSessionEpoch()).not.toBe(newSessionEpoch());
  });
});

describe("updateAuthState", () => {
  it("serializes concurrent updates so none is lost", async () => {
    await Promise.all([
      updateAuthState(path, async (s) => {
        await new Promise((r) => setTimeout(r, 30));
        return { ...s, passwordHash: "$argon2id$slow", baseHash: null };
      }),
      updateAuthState(path, (s) => ({ ...s, sessionEpoch: "abcd" })),
    ]);
    expect(readAuthState(path)).toEqual({ passwordHash: "$argon2id$slow", baseHash: null, sessionEpoch: "abcd" });
  });

  it("refuses to rewrite a damaged file, so a panel-set password is never silently dropped", async () => {
    const file = join(dir, "damaged.json");
    writeFileSync(file, '{"version":1,"passwordHash":"$argon2id$x"');
    await expect(updateAuthState(file, (s) => ({ ...s, sessionEpoch: "abcd" }))).rejects.toBeInstanceOf(AuthStateCorruptError);
    expect(readFileSync(file, "utf8")).toBe('{"version":1,"passwordHash":"$argon2id$x"');
  });

  it("keeps working after a failed update", async () => {
    await expect(updateAuthState(path, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await updateAuthState(path, (s) => ({ ...s, sessionEpoch: "beef" }));
    expect(readAuthState(path).sessionEpoch).toBe("beef");
  });
});
