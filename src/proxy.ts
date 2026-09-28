import { NextResponse, type NextRequest } from "next/server";
import { isMutation, isSameOriginRequest, sessionFromHeaders } from "./lib/auth/request";

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
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (signedIn) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ success: false, data: null, error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js internals/assets and the favicon.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
