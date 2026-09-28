import { NextResponse, type NextRequest } from "next/server";
import { isMutation, isSameOriginRequest, sessionFromHeaders } from "./lib/auth/request";

/**
 * Relative redirect: stays on whatever host the admin used. Next normalizes
 * 127.0.0.1 to "localhost" in absolute URLs, which would drop the session
 * cookie for anyone reaching the panel through an SSH tunnel.
 */
function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: location } });
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
      return redirectTo("/");
    }
    return NextResponse.next();
  }

  if (signedIn) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ success: false, data: null, error: "Not signed in" }, { status: 401 });
  }
  const next = pathname === "/" ? "" : `?${new URLSearchParams({ next: `${pathname}${search}` })}`;
  return redirectTo(`/login${next}`);
}

export const config = {
  // Everything except Next.js internals/assets and the favicon.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
