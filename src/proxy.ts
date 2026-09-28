import { NextResponse, type NextRequest } from "next/server";
import { isMutation, isSameOriginRequest, sessionFromHeaders } from "./lib/auth/request";

/**
 * Redirects to a path on the same host the admin used. Next normalizes
 * 127.0.0.1 to "localhost" in request.url, which would drop the session cookie
 * for anyone reaching the panel through an SSH tunnel, so the Host header is
 * used instead (it only ever redirects the requester back to itself).
 */
const HOST_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;

function redirectTo(request: NextRequest, path: string): NextResponse {
  const host = request.headers.get("host");
  const base = host && HOST_PATTERN.test(host) ? `${request.nextUrl.protocol}//${host}` : request.url;
  return NextResponse.redirect(new URL(path, base), 307);
}

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(["/login", "/api/health", "/api/auth/login"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isMutation(request.method) && !isSameOriginRequest(request.headers)) {
    return NextResponse.json({ success: false, data: null, error: "Cross-origin request blocked" }, { status: 403 });
  }

  const signedIn = sessionFromHeaders(request.headers) !== null;

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && signedIn) {
      return redirectTo(request, "/");
    }
    return NextResponse.next();
  }

  if (signedIn) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ success: false, data: null, error: "Not signed in" }, { status: 401 });
  }
  const next = pathname === "/" ? "" : `?${new URLSearchParams({ next: `${pathname}${search}` })}`;
  return redirectTo(request, `/login${next}`);
}

export const config = {
  // Everything except Next.js internals/assets and the favicon.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
