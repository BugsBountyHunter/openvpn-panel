import { z } from "zod";
import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/auth/guard";
import { certDaysSchema } from "@/lib/cert-days";
import { getConfig } from "@/lib/config";
import { fail, failFromError } from "@/lib/http";
import { parseClientName } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

const renewSchema = z.object({ certDays: certDaysSchema.optional() });

/** Re-issues the certificate and streams the new profile back. The profile is never stored or logged. */
export const POST = withAuth<RouteContext<"/api/clients/[name]/renew">>(async (request, ctx, { actor, ip }) => {
  const name = parseClientName((await ctx.params).name);
  if (!name) return fail("Invalid client name", 400);
  const parsed = renewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const { certDays } = parsed.data;
  const auditPath = getConfig().auditLogPath;
  const detail = certDays === undefined ? undefined : `${certDays} days`;
  try {
    const profile = await getPanel().renewClient(name, { certDays });
    await audit(auditPath, { actor, action: "renew", target: name, ip, ok: true, detail });
    return new Response(profile, {
      headers: {
        "Content-Type": "application/x-openvpn-profile",
        "Content-Disposition": `attachment; filename="${name}.ovpn"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    await audit(auditPath, { actor, action: "renew", target: name, ip, ok: false, detail: reason });
    return failFromError(error, "Renewing client");
  }
});
