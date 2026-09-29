import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed session tokens: base64url(JSON payload) + "." + HMAC-SHA256.
 * Rotating SESSION_SECRET invalidates every session.
 */

export const SESSION_COOKIE = "ovpn_panel_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  /** Username. */
  sub: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Session epoch (see auth/state.ts); absent on tokens from the initial epoch. */
  sep?: string;
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function createSessionToken(
  user: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
  sessionEpoch: string = "",
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = { sub: user, iat, exp: iat + ttlSeconds, ...(sessionEpoch ? { sep: sessionEpoch } : {}) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const epochOk = v.sep === undefined || (typeof v.sep === "string" && v.sep.length <= 64);
  return typeof v.sub === "string" && Number.isInteger(v.iat) && Number.isInteger(v.exp) && epochOk;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): SessionPayload | null {
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = sign(body, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(payload)) return null;
  const now = Math.floor(nowMs / 1000);
  if (payload.exp <= now || payload.iat > now + 60) return null;
  return payload;
}
