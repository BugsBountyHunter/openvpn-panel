import { beforeAll, describe, expect, it } from "vitest";
import { withAuth } from "./guard";
import { SESSION_COOKIE, createSessionToken } from "./session";

const SECRET = "g".repeat(40);
const ORIGIN = "http://10.8.0.1:8081";

beforeAll(() => {
  (globalThis as { __panelConfig?: unknown }).__panelConfig = undefined;
  process.env.PANEL_MODE = "demo";
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_USER = "admin";
});

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/x`, { method, headers: { host: "10.8.0.1:8081", ...headers } });
}

const cookie = (user = "admin") => `${SESSION_COOKIE}=${createSessionToken(user, SECRET)}`;
const handler = withAuth(async (_req, _ctx, auth) => Response.json(auth));

describe("withAuth", () => {
  it("rejects requests without a session", async () => {
    expect((await handler(request("GET"), {})).status).toBe(401);
  });

  it("rejects sessions for a different user", async () => {
    expect((await handler(request("GET", { cookie: cookie("mallory") }), {})).status).toBe(401);
  });

  it("rejects cross-origin mutations even with a valid session", async () => {
    const res = await handler(request("POST", { cookie: cookie(), origin: "https://evil.example" }), {});
    expect(res.status).toBe(403);
  });

  it("passes actor and ip to the handler", async () => {
    const res = await handler(
      request("POST", { cookie: cookie(), origin: ORIGIN, "x-forwarded-for": "10.8.0.6" }),
      {},
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actor: "admin", ip: "10.8.0.6" });
  });
});
