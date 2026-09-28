import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PkiWarnings } from "@/components/PkiWarnings";
import { Badge, Card, StatCard } from "@/components/ui";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { getPanel, loadSnapshot } from "@/lib/panel";
import { pkiWarnings, type PkiWarning } from "@/lib/pki";

export const dynamic = "force-dynamic";

/** A failed PKI check must not take the overview down; it is logged and shown as unknown. */
async function loadPkiWarnings(now: number): Promise<PkiWarning[] | null> {
  try {
    return pkiWarnings(await getPanel().getPki(), now);
  } catch (error) {
    console.error("[openvpn-panel] PKI check failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export default async function OverviewPage() {
  const { status, clients, now } = await loadSnapshot();
  const pki = await loadPkiWarnings(now);
  const online = clients.filter((c) => c.online);
  const active = clients.filter((c) => c.status === "active").length;
  const expiringSoon = clients.filter(
    (c) => c.status === "active" && c.daysRemaining !== null && c.daysRemaining <= 30,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {status.version ? <span className="text-xs text-muted">{status.version}</span> : null}
          <AutoRefresh intervalMs={10_000} updatedAt={now} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="OpenVPN"
          value={status.up ? <Badge tone="ok">● up</Badge> : <Badge tone="danger">● down</Badge>}
          hint={status.up ? null : status.error}
        />
        <StatCard
          label="Uptime"
          value={status.up && status.startedAt ? formatDuration(now - status.startedAt) : "—"}
          hint={status.up && status.startedAt ? `since ${formatDateTime(status.startedAt)}` : null}
        />
        <StatCard label="Connected" value={status.connectedCount} hint={`${active} active certificates`} />
        <StatCard
          label="Total traffic"
          value={formatBytes(status.bytesIn + status.bytesOut)}
          hint={`↓ ${formatBytes(status.bytesIn)} in · ↑ ${formatBytes(status.bytesOut)} out`}
        />
      </div>

      {pki ? (
        <PkiWarnings warnings={pki} />
      ) : (
        <p className="text-xs text-muted">Could not check certificate and CRL expiry. See the panel logs.</p>
      )}

      {expiringSoon > 0 ? (
        <p className="rounded-lg border border-border bg-warn-bg px-4 py-2 text-sm text-warn">
          {expiringSoon} certificate{expiringSoon === 1 ? " expires" : "s expire"} within 30 days.{" "}
          <Link href="/clients" className="underline">Review clients</Link>
        </p>
      ) : null}

      <Card title="Online now" actions={<Link href="/clients" className="text-sm text-accent">All clients →</Link>}>
        {online.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Nobody is connected.</p>
        ) : (
          <ul className="divide-y divide-border">
            {online.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-muted">{c.vpnIp} ← {c.realIp}</span>
                <span className="tabular-nums text-muted">
                  {formatBytes(c.bytesIn + c.bytesOut)} · {c.connectedSince ? formatDuration(now - c.connectedSince) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
