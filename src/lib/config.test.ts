import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const SECRET = "x".repeat(32);
const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("defaults to demo mode bound to localhost", () => {
    const config = loadConfig(env({}));
    expect(config.mode).toBe("demo");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8081);
    expect(config.mgmt).toEqual({ kind: "tcp", host: "127.0.0.1", port: 7505 });
    expect(config.adminPasswordHash).toBeNull();
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("requires a password hash and strong secret in live mode", () => {
    expect(() => loadConfig(env({ PANEL_MODE: "live" }))).toThrow(/ADMIN_PASSWORD_HASH/);
    expect(() =>
      loadConfig(env({ PANEL_MODE: "live", ADMIN_PASSWORD_HASH: "$2b$..", SESSION_SECRET: "short" })),
    ).toThrow(/SESSION_SECRET/);
  });

  it("accepts a complete live configuration", () => {
    const config = loadConfig(env({
      PANEL_MODE: "live",
      PANEL_HOST: "10.8.0.1",
      PANEL_PORT: "9000",
      OVPN_MGMT: "unix:/run/mgmt.sock",
      ADMIN_PASSWORD_HASH: "$2b$12$abc",
      SESSION_SECRET: SECRET,
    }));
    expect(config).toMatchObject({ mode: "live", host: "10.8.0.1", port: 9000, sessionSecret: SECRET });
  });

  it("rejects bad management addresses and relative helper paths", () => {
    expect(() => loadConfig(env({ OVPN_MGMT: "localhost:7505" }))).toThrow(/OVPN_MGMT/);
    expect(() => loadConfig(env({ PANEL_HELPER: "helper" }))).toThrow(/PANEL_HELPER/);
  });
});
