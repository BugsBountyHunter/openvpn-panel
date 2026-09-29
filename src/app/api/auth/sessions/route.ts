import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { sessionCookie } from "@/lib/auth/cookie";
import { withAuth } from "@/lib/auth/guard";
import { createSessionToken } from "@/lib/auth/session";
import { newSessionEpoch, sessionEpochFor, updateAuthState } from "@/lib/auth/state";
import { authStateFailure } from "@/lib/auth/state-errors";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Signs out every other session (e.g. a lost laptop) and re-issues this one. */
export const POST = withAuth(async (request, _ctx, { actor, ip }) => {
  const config = getConfig();
  let state;
  try {
    state = await updateAuthState(config.authStatePath, (current) => ({ ...current, sessionEpoch: newSessionEpoch() }));
  } catch (error) {
    await audit(config.auditLogPath, { actor, action: "sessions_revoked", target: null, ip, ok: false, detail: "could not save" });
    return authStateFailure(error, "Signing out other sessions");
  }
  await audit(config.auditLogPath, { actor, action: "sessions_revoked", target: null, ip, ok: true });

  const token = createSessionToken(config.adminUser, config.sessionSecret, Date.now(), undefined, sessionEpochFor(config.adminPasswordHash, state));
  const response = NextResponse.json({ success: true, data: null, error: null }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookie(token, request.url));
  return response;
});
