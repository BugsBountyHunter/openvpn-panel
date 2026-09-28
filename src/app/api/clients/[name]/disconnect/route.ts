import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { fail, failFromError, ok } from "@/lib/http";
import { parseClientName } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

export const POST = withAuth<RouteContext<"/api/clients/[name]/disconnect">>(async (_request, ctx, { actor, ip }) => {
  const name = parseClientName((await ctx.params).name);
  if (!name) return fail("Invalid client name", 400);
  const auditPath = getConfig().auditLogPath;
  try {
    const disconnected = await getPanel().disconnectClient(name);
    await audit(auditPath, {
      actor,
      action: "disconnect",
      target: name,
      ip,
      ok: true,
      ...(disconnected ? {} : { detail: "not connected" }),
    });
    return ok({ name, disconnected });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    await audit(auditPath, { actor, action: "disconnect", target: name, ip, ok: false, detail });
    return failFromError(error, "Disconnecting client");
  }
});
