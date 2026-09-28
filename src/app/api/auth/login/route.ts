import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { sessionCookie } from "@/lib/auth/cookie";
import { attemptLogin } from "@/lib/auth/login";
import { getLoginLimiter } from "@/lib/auth/rate-limit";
import { clientIp, isSameOriginRequest } from "@/lib/auth/request";
import { getConfig } from "@/lib/config";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers)) return fail("Cross-origin request blocked", 403);
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Username and password are required", 400);

  const config = getConfig();
  const ip = clientIp(request.headers);
  const { username, password } = parsed.data;
  const result = await attemptLogin({ username, password, ip }, config, getLoginLimiter());

  await audit(config.auditLogPath, {
    actor: username,
    action: result.ok ? "login" : "login_failed",
    target: null,
    ip,
    ok: result.ok,
    ...(result.ok ? {} : { detail: result.status === 429 ? "rate limited" : "bad credentials" }),
  });

  if (!result.ok) {
    const response = fail(result.error, result.status);
    if (result.retryAfter) response.headers.set("Retry-After", String(result.retryAfter));
    return response;
  }

  const response = NextResponse.json({ success: true, data: { user: config.adminUser }, error: null });
  response.cookies.set(sessionCookie(result.token, request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
