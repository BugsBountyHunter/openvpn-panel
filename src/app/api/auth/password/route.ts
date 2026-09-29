import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { sessionCookie } from "@/lib/auth/cookie";
import { withAuth } from "@/lib/auth/guard";
import { checkPassword } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { newPasswordSchema } from "@/lib/auth/password-policy";
import { getLoginLimiter } from "@/lib/auth/rate-limit";
import { createSessionToken } from "@/lib/auth/session";
import { newSessionEpoch, sessionEpochFor, updateAuthState } from "@/lib/auth/state";
import { getConfig } from "@/lib/config";
import { authStateFailure } from "@/lib/auth/state-errors";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: newPasswordSchema,
});

/**
 * Changes the admin password. Requires the current password (rate-limited like
 * sign-in), stores only an argon2id hash, signs out every other session and
 * re-issues this one. Passwords are never logged.
 */
export const POST = withAuth(async (request, _ctx, { actor, ip }) => {
  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword === currentPassword) return fail("The new password must be different", 400);

  const config = getConfig();
  const limiter = getLoginLimiter();
  const now = Date.now();
  const retryAfter = limiter.retryAfter(ip, now);
  if (retryAfter > 0) {
    const response = fail("Too many failed attempts. Try again later.", 429);
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }
  // Count the attempt before the slow verify so parallel guesses cannot exceed
  // the limit; a correct password clears it again.
  limiter.recordFailure(ip, now);
  if (!(await checkPassword(currentPassword, config))) {
    await audit(config.auditLogPath, { actor, action: "password_change", target: null, ip, ok: false, detail: "wrong current password" });
    return fail("Current password is incorrect", 401);
  }
  limiter.recordSuccess(ip);

  let state;
  try {
    // Hash outside the lock; the update itself is quick.
    const passwordHash = await hashPassword(newPassword);
    state = await updateAuthState(config.authStatePath, (current) => ({
      ...current,
      passwordHash,
      baseHash: config.adminPasswordHash,
      sessionEpoch: newSessionEpoch(),
    }));
  } catch (error) {
    await audit(config.auditLogPath, { actor, action: "password_change", target: null, ip, ok: false, detail: "could not save" });
    return authStateFailure(error, "Changing the password");
  }
  await audit(config.auditLogPath, { actor, action: "password_change", target: null, ip, ok: true });

  const token = createSessionToken(config.adminUser, config.sessionSecret, now, undefined, sessionEpochFor(config.adminPasswordHash, state));
  const response = NextResponse.json({ success: true, data: null, error: null }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookie(token, request.url));
  return response;
});
