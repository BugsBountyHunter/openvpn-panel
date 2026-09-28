import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { clearedSessionCookie } from "@/lib/auth/cookie";
import { withAuth } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request, _ctx, { actor, ip }) => {
  await audit(getConfig().auditLogPath, { actor, action: "logout", target: null, ip, ok: true });
  const response = NextResponse.json({ success: true, data: null, error: null });
  response.cookies.set(clearedSessionCookie(request.url));
  return response;
});
