import { audit, readAudit } from "@/lib/audit";
import { auditToCsv, filterAudit, parseAuditFilter } from "@/lib/audit-view";
import { withAuth } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { failFromError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Everything in the readable tail of the log (see readAudit), not just one page. */
const EXPORT_LIMIT = 50_000;

function fileStamp(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Downloads the audit log as CSV, using the same filters as the audit page. */
export const GET = withAuth(async (request, _ctx, { actor, ip }) => {
  const auditPath = getConfig().auditLogPath;
  const filter = parseAuditFilter(new URL(request.url).searchParams);
  try {
    const entries = filterAudit(await readAudit(auditPath, EXPORT_LIMIT), filter);
    await audit(auditPath, { actor, action: "audit_export", target: null, ip, ok: true, detail: `${entries.length} rows` });
    return new Response(auditToCsv(entries), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="openvpn-panel-audit-${fileStamp(new Date())}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failFromError(error, "Exporting the audit log");
  }
});
