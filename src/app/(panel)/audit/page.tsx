import { Badge, Card } from "@/components/ui";
import { readAudit, type AuditAction } from "@/lib/audit";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const LABELS: Record<AuditAction, string> = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  logout: "Signed out",
  add: "Added client",
  revoke: "Revoked client",
  disconnect: "Disconnected client",
};

export default async function AuditPage() {
  const entries = await readAudit(getConfig().auditLogPath);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <Card title={`Latest ${entries.length} events`}>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] whitespace-nowrap text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">When (UTC)</th>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">What</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">From</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{e.ts.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-4 py-2">{e.actor}</td>
                    <td className="px-4 py-2">{LABELS[e.action]}</td>
                    <td className="px-4 py-2">{e.target ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.ip ?? "—"}</td>
                    <td className="px-4 py-2">
                      {e.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="danger">failed</Badge>}
                      {e.detail ? <span className="ml-2 text-xs text-muted">{e.detail}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
