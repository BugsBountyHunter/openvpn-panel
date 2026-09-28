/**
 * Integration tests: real route handlers + proxy, demo backend, temp audit log.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "http://127.0.0.1:8081";
const dir = mkdtempSync(join(tmpdir(), "panel-api-"));
const auditPath = join(dir, "audit.log");

type Routes = {
  login: typeof import("@/app/api/auth/login/route");
  logout: typeof import("@/app/api/auth/logout/route");
  clients: typeof import("@/app/api/clients/route");
  revoke: typeof import("@/app/api/clients/[name]/revoke/route");
  renew: typeof import("@/app/api/clients/[name]/renew/route");
  disconnect: typeof import("@/app/api/clients/[name]/disconnect/route");
  status: typeof import("@/app/api/status/route");
  health: typeof import("@/app/api/health/route");
  proxy: typeof import("@/proxy");
  demo: typeof import("@/lib/backend/demo");
};
let r: Routes;

beforeAll(async () => {
  Object.assign(process.env, {
    PANEL_MODE: "demo",
    ADMIN_USER: "admin",
    SESSION_SECRET: "i".repeat(40),
    AUDIT_LOG_PATH: auditPath,
  });
  delete process.env.ADMIN_PASSWORD_HASH;
  const g = globalThis as Record<string, unknown>;
  delete g.__panelConfig;
  delete g.__panelBackend;
  delete g.__loginLimiter;
  r = {
    login: await import("@/app/api/auth/login/route"),
    logout: await import("@/app/api/auth/logout/route"),
    clients: await import("@/app/api/clients/route"),
    revoke: await import("@/app/api/clients/[name]/revoke/route"),
    renew: await import("@/app/api/clients/[name]/renew/route"),
    disconnect: await import("@/app/api/clients/[name]/disconnect/route"),
    status: await import("@/app/api/status/route"),
    health: await import("@/app/api/health/route"),
    proxy: await import("@/proxy"),
    demo: await import("@/lib/backend/demo"),
  };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => r.demo.resetDemoState());

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: "127.0.0.1:8081", "x-forwarded-for": "10.8.0.9" };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (name: string) => ({ params: Promise.resolve({ name }) });

async function login(): Promise<string> {
  const res = await r.login.POST(req("/api/auth/login", { method: "POST", body: { username: "admin", password: "demo" } }));
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Strict/i);
  return setCookie.split(";")[0];
}

const auditActions = () =>
  readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { action: string; ok: boolean; target: string | null });

describe("API", () => {
  it("health is public and minimal", async () => {
    const res = r.health.GET();
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects bad credentials and audits the attempt", async () => {
    const res = await r.login.POST(req("/api/auth/login", { method: "POST", body: { username: "admin", password: "x" } }));
    expect(res.status).toBe(401);
    expect(auditActions().at(-1)).toMatchObject({ action: "login_failed", ok: false });
  });

  it("rejects cross-origin login", async () => {
    const res = await r.login.POST(
      req("/api/auth/login", { method: "POST", body: { username: "admin", password: "demo" }, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  it("full client lifecycle: add -> list -> disconnect -> revoke, all audited", async () => {
    const cookie = await login();

    const added = await r.clients.POST(req("/api/clients", { method: "POST", body: { name: "laptop-1" }, cookie }), {});
    expect(added.status).toBe(201);
    expect(added.headers.get("content-disposition")).toBe('attachment; filename="laptop-1.ovpn"');
    expect(added.headers.get("cache-control")).toBe("no-store");
    const profile = await added.text();
    expect(profile).toContain("client");

    const list = await (await r.clients.GET(req("/api/clients", { cookie }), {})).json();
    expect(list.data.map((c: { name: string }) => c.name)).toContain("laptop-1");
    expect(list.data.some((c: { name: string }) => c.name.startsWith("server_"))).toBe(false);

    const disc = await r.disconnect.POST(req("/api/clients/bob-phone/disconnect", { method: "POST", cookie }), params("bob-phone"));
    expect((await disc.json()).data).toEqual({ name: "bob-phone", disconnected: true });

    const rev = await r.revoke.POST(req("/api/clients/laptop-1/revoke", { method: "POST", cookie }), params("laptop-1"));
    expect(rev.status).toBe(200);

    const log = readFileSync(auditPath, "utf8");
    expect(log).not.toContain(profile.split("\n")[0]); // profile never logged
    const actions = auditActions().filter((e) => e.target === "laptop-1" || e.target === "bob-phone").map((e) => e.action);
    expect(actions).toEqual(["add", "disconnect", "revoke"]);
  });

  it("renews a client, streams the new profile and audits it", async () => {
    const cookie = await login();
    const res = await r.renew.POST(
      req("/api/clients/erin-tablet/renew", { method: "POST", body: { certDays: 365 }, cookie }),
      params("erin-tablet"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="erin-tablet.ovpn"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("client");
    expect(auditActions().at(-1)).toMatchObject({ action: "renew", target: "erin-tablet", ok: true });

    const bad = await r.renew.POST(
      req("/api/clients/erin-tablet/renew", { method: "POST", body: { certDays: 0 }, cookie }),
      params("erin-tablet"),
    );
    expect(bad.status).toBe(400);

    const revoked = await r.renew.POST(req("/x", { method: "POST", body: {}, cookie }), params("dave-old"));
    expect(revoked.status).toBe(409);
    expect(auditActions().at(-1)).toMatchObject({ action: "renew", target: "dave-old", ok: false });
  });

  it("validates input and protects the server certificate", async () => {
    const cookie = await login();
    const bad = await r.clients.POST(req("/api/clients", { method: "POST", body: { name: "../etc" }, cookie }), {});
    expect(bad.status).toBe(400);
    const server = await r.revoke.POST(req("/x", { method: "POST", cookie }), params("server_a1b2c3d4"));
    expect(server.status).toBe(400);
    const dup = await r.clients.POST(req("/api/clients", { method: "POST", body: { name: "alice-laptop" }, cookie }), {});
    expect(dup.status).toBe(409);
  });

  it("status requires a session and returns a snapshot", async () => {
    expect((await r.status.GET(req("/api/status"), {})).status).toBe(401);
    const cookie = await login();
    const body = await (await r.status.GET(req("/api/status", { cookie }), {})).json();
    expect(body.data.status.up).toBe(true);
    expect(Array.isArray(body.data.clients)).toBe(true);
  });

  it("logout clears the cookie", async () => {
    const cookie = await login();
    const res = await r.logout.POST(req("/api/auth/logout", { method: "POST", cookie }), {});
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});

describe("proxy", () => {
  it("redirects anonymous page views to /login with next", () => {
    const res = r.proxy.proxy(req("/clients", { origin: null }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?next=%2Fclients`);
  });

  it("returns 401 JSON for anonymous API calls and allows public paths", async () => {
    expect(r.proxy.proxy(req("/api/clients", { origin: null })).status).toBe(401);
    expect(r.proxy.proxy(req("/api/health", { origin: null })).headers.get("x-middleware-next")).toBe("1");
  });

  it("blocks cross-origin mutations before routing", () => {
    expect(r.proxy.proxy(req("/api/auth/login", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
  });

  it("sends signed-in users away from /login", async () => {
    const cookie = await login();
    const res = r.proxy.proxy(req("/login", { cookie, origin: null }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
  });
});
