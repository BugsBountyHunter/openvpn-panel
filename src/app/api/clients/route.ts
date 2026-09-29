import { z } from "zod";
import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { fail, failFromError, ok } from "@/lib/http";
import { certDaysSchema } from "@/lib/cert-days";
import { passphraseSchema } from "@/lib/client-options";
import { clientNameSchema } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

const addSchema = z.object({
  name: clientNameSchema,
  certDays: certDaysSchema.optional(),
  passphrase: passphraseSchema.optional(),
});

/** What the audit log records about the options: never the passphrase itself. */
function optionsDetail(certDays: number | undefined, passphrase: string | undefined): string | undefined {
  const parts = [certDays === undefined ? null : `${certDays} days`, passphrase === undefined ? null : "passphrase"];
  return parts.filter(Boolean).join(", ") || undefined;
}

export const GET = withAuth(async () => {
  try {
    return ok(await getPanel().listClients());
  } catch (error) {
    return failFromError(error, "Listing clients");
  }
});

/** Creates a client and streams its profile back. The profile is never stored or logged. */
export const POST = withAuth(async (request, _ctx, { actor, ip }) => {
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  const { name, certDays, passphrase } = parsed.data;
  const auditPath = getConfig().auditLogPath;
  try {
    const profile = await getPanel().addClient(name, { certDays, passphrase });
    await audit(auditPath, { actor, action: "add", target: name, ip, ok: true, detail: optionsDetail(certDays, passphrase) });
    return new Response(profile, {
      status: 201,
      headers: {
        "Content-Type": "application/x-openvpn-profile",
        "Content-Disposition": `attachment; filename="${name}.ovpn"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await audit(auditPath, { actor, action: "add", target: name, ip, ok: false, detail: errorDetail(error) });
    return failFromError(error, "Adding client");
  }
});

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
