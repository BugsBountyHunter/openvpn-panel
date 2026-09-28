import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { fail, failFromError, ok } from "@/lib/http";
import { parseClientName } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

export const POST = withAuth<RouteContext<"/api/clients/[name]/revoke">>(async (_request, ctx, { actor, ip }) => {
  const name = parseClientName((await ctx.params).name);
  if (!name) return fail("Invalid client name", 400);
  const auditPath = getConfig().auditLogPath;
  try {
    await getPanel().revokeClient(name);
    await audit(auditPath, { actor, action: "revoke", target: name, ip, ok: true });
    return ok({ name, revoked: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    await audit(auditPath, { actor, action: "revoke", target: name, ip, ok: false, detail });
    return failFromError(error, "Revoking client");
  }
});
