"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  countByStatus,
  EXPIRY_WARNING_DAYS,
  nextSort,
  selectClients,
  STATUS_FILTERS,
  type SortKey,
  type SortState,
  type StatusFilter,
} from "@/lib/client-view";
import { formatBytes, formatDuration } from "@/lib/format";
import type { AddOptions, VpnClient } from "@/lib/types";
import { AddClientDialog } from "./AddClientDialog";
import { addClientAndDownload, apiPost, renewClientAndDownload, UnauthorizedError } from "./api-client";
import { Button, Modal } from "./Modal";
import { RenewDialog } from "./RenewDialog";
import { Badge } from "./ui";

interface ClientsTableProps {
  clients: VpnClient[];
  /** Server render time, so relative durations match between server and client. */
  now: number;
}

type PendingAction = { kind: "revoke" | "disconnect"; name: string } | null;

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: "Active",
  online: "Online",
  offline: "Offline",
  expiring: `Expiring (≤${EXPIRY_WARNING_DAYS}d)`,
  revoked: "Revoked",
  all: "All",
};

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}

function SortHeader({ label, sortKey, sort, onSort, align = "left" }: SortHeaderProps) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  const ariaSort = dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
  return (
    <th aria-sort={ariaSort} className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-text"
      >
        {label}
        <span aria-hidden className="w-2">{dir === "asc" ? "↑" : dir === "desc" ? "↓" : ""}</span>
      </button>
    </th>
  );
}

function ExpiryCell({ client }: { client: VpnClient }) {
  if (!client.certExpiry) return <span className="text-muted">unknown</span>;
  const days = client.daysRemaining;
  const soon = days !== null && days <= EXPIRY_WARNING_DAYS;
  return (
    <span className={soon ? "font-medium text-warn" : undefined} title={days !== null ? `${days} days left` : undefined}>
      {client.certExpiry}
      {soon && days !== null ? ` (${days < 0 ? "expired" : `${days}d`})` : null}
    </span>
  );
}

export function ClientsTable({ clients, now }: ClientsTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sort, setSort] = useState<SortState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () => selectClients(clients, { status: statusFilter, query, sort }),
    [clients, statusFilter, query, sort],
  );
  const counts = useMemo(() => countByStatus(clients), [clients]);
  const onSort = (key: SortKey) => setSort((current) => nextSort(current, key));

  const refresh = () => startTransition(() => router.refresh());

  /** Resolves true when the action succeeded. */
  async function run(action: () => Promise<void>, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      refresh();
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return false;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onAdd(name: string, options: AddOptions): Promise<boolean> {
    return run(async () => {
      await addClientAndDownload(name, options);
      setAddOpen(false);
    }, `Created "${name}". The profile was downloaded and is not stored on the server.`);
  }

  async function onRenew(name: string, certDays: number | undefined) {
    await run(async () => {
      await renewClientAndDownload(name, certDays);
      setRenewing(null);
    }, `Renewed "${name}". The new profile was downloaded; the old one no longer works.`);
  }

  async function onConfirm() {
    if (!pending) return;
    const { kind, name } = pending;
    await run(async () => {
      await apiPost(`/api/clients/${encodeURIComponent(name)}/${kind}`);
      setPending(null);
    }, kind === "revoke" ? `Revoked "${name}".` : `Disconnected "${name}".`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <input
          type="search"
          placeholder="Search name or IP"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients by name or IP"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {STATUS_LABELS[filter]} ({counts[filter]})
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => { setError(null); setAddOpen(true); }}>
            Add client
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border-b border-border bg-danger-bg px-4 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p role="status" className="border-b border-border bg-ok-bg px-4 py-2 text-sm text-ok">{notice}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[50rem] whitespace-nowrap text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <SortHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
              <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
              <SortHeader label="Cert expiry" sortKey="expiry" sort={sort} onSort={onSort} />
              <th className="px-4 py-2 font-medium">Real IP</th>
              <th className="px-4 py-2 font-medium">VPN IP</th>
              <SortHeader label="In / Out" sortKey="traffic" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Connected" sortKey="connected" sort={sort} onSort={onSort} />
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  No clients match.
                </td>
              </tr>
            ) : (
              visible.map((c) => (
                <tr key={c.name} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1.5">
                      {c.status === "revoked" ? (
                        <Badge tone="danger">revoked</Badge>
                      ) : c.online ? (
                        <Badge tone="ok">● online</Badge>
                      ) : (
                        <Badge tone="neutral">offline</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums"><ExpiryCell client={c} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.realIp ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.vpnIp ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.online ? `${formatBytes(c.bytesIn)} / ${formatBytes(c.bytesOut)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums" title={c.connectedSince ? new Date(c.connectedSince).toISOString() : undefined}>
                    {c.connectedSince ? `${formatDuration(now - c.connectedSince)} ago` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      {c.online ? (
                        <Button variant="ghost" onClick={() => { setError(null); setPending({ kind: "disconnect", name: c.name }); }}>
                          Disconnect
                        </Button>
                      ) : null}
                      {c.status === "active" ? (
                        <Button variant="ghost" onClick={() => { setError(null); setRenewing(c.name); }}>
                          Renew
                        </Button>
                      ) : null}
                      {c.status === "active" ? (
                        <Button variant="ghost" onClick={() => { setError(null); setPending({ kind: "revoke", name: c.name }); }}>
                          <span className="text-danger">Revoke</span>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AddClientDialog open={addOpen} busy={busy} error={error} onClose={() => setAddOpen(false)} onAdd={onAdd} />

      <RenewDialog name={renewing} busy={busy} error={error} onClose={() => setRenewing(null)} onRenew={onRenew} />

      <Modal
        open={pending !== null}
        title={pending?.kind === "revoke" ? "Revoke client?" : "Disconnect client?"}
        onClose={() => setPending(null)}
      >
        <p className="text-sm text-muted">
          {pending?.kind === "revoke" ? (
            <>
              <strong className="text-text">{pending.name}</strong> will be revoked permanently and disconnected. Its
              profile will stop working. This cannot be undone.
            </>
          ) : (
            <>
              <strong className="text-text">{pending?.name}</strong> will be disconnected now. The client may reconnect
              automatically — revoke it to block access.
            </>
          )}
        </p>
        {error && pending ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant={pending?.kind === "revoke" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : pending?.kind === "revoke" ? "Revoke" : "Disconnect"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
