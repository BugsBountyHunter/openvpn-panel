import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session";

interface CookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "strict";
  secure: boolean;
  path: "/";
  maxAge: number;
}

/** Secure flag follows the scheme the panel was reached by (plain HTTP over the VPN is common). */
export function sessionCookie(token: string, requestUrl: string): CookieOptions {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedSessionCookie(requestUrl: string): CookieOptions {
  return { ...sessionCookie("", requestUrl), maxAge: 0 };
}
