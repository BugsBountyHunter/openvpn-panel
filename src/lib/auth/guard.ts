import { fail } from "../http";
import { clientIp, isMutation, isSameOriginRequest, sessionFromHeaders } from "./request";

export interface RequestContext {
  actor: string;
  ip: string;
}

type Guarded<C> = (request: Request, ctx: C, auth: RequestContext) => Promise<Response>;

/**
 * Wraps a route handler with session and CSRF checks. The proxy enforces the
 * same rules; this is defence in depth in case a matcher ever misses a route.
 */
export function withAuth<C>(handler: Guarded<C>): (request: Request, ctx: C) => Promise<Response> {
  return async (request, ctx) => {
    if (isMutation(request.method) && !isSameOriginRequest(request.headers)) {
      return fail("Cross-origin request blocked", 403);
    }
    const session = sessionFromHeaders(request.headers);
    if (!session) return fail("Not signed in", 401);
    return handler(request, ctx, { actor: session.sub, ip: clientIp(request.headers) });
  };
}
