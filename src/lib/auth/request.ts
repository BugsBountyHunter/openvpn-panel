import { getConfig } from "../config";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isMutation(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * CSRF defence for state-changing requests: the browser-supplied Origin must
 * match the Host we were addressed by, and Fetch Metadata (when present) must
 * say same-origin. Combined with SameSite=Strict cookies and JSON-only bodies.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const IP_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Client address. In production the start wrapper (scripts/start.mjs) replaces
 * X-Forwarded-For with the socket address, so it cannot be spoofed.
 */
export function clientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = first.replace(/^::ffff:/, "");
  return IP_PATTERN.test(ip) ? ip : "unknown";
}

export function readSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function sessionFromHeaders(headers: Headers): SessionPayload | null {
  const { sessionSecret, adminUser } = getConfig();
  const session = verifySessionToken(readSessionCookie(headers.get("cookie")), sessionSecret);
  // A change of ADMIN_USER invalidates existing sessions.
  return session && session.sub === adminUser ? session : null;
}
