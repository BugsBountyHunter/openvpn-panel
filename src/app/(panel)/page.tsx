import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, Card, StatCard } from "@/components/ui";
import { EXPIRY_WARNING_DAYS, isExpiringSoon } from "@/lib/client-view";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { loadSnapshot } from "@/lib/panel";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { status, clients, now } = await loadSnapshot();
  const online = clients.filter((c) => c.online);
  const active = clients.filter((c) => c.status === "active").length;
  const expiringSoon = clients.filter(isExpiringSoon).length;

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={10_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        {status.version ? <span className="text-xs text-muted">{status.version}</span> : null}
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

      {expiringSoon > 0 ? (
        <p className="rounded-lg border border-border bg-warn-bg px-4 py-2 text-sm text-warn">
          {expiringSoon} certificate{expiringSoon === 1 ? " expires" : "s expire"} within {EXPIRY_WARNING_DAYS} days.{" "}
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
