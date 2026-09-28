"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { formatBytes, formatDuration } from "@/lib/format";
import { CLIENT_NAME_PATTERN } from "@/lib/names";
import type { VpnClient } from "@/lib/types";
import { addClientAndDownload, apiPost, UnauthorizedError } from "./api-client";
import { Button, Modal } from "./Modal";
import { Badge } from "./ui";

interface ClientsTableProps {
  clients: VpnClient[];
  /** Server render time, so relative durations match between server and client. */
  now: number;
}

type PendingAction = { kind: "revoke" | "disconnect"; name: string } | null;

const EXPIRY_WARNING_DAYS = 30;

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
  const [showRevoked, setShowRevoked] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter(
      (c) => (showRevoked || c.status === "active") && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [clients, query, showRevoked]);

  const revokedCount = clients.filter((c) => c.status === "revoked").length;
  const nameValid = CLIENT_NAME_PATTERN.test(newName) && !newName.startsWith("server_");

  const refresh = () => startTransition(() => router.refresh());

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      refresh();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!nameValid) return;
    const name = newName;
    await run(async () => {
      await addClientAndDownload(name);
      setAddOpen(false);
      setNewName("");
    }, `Created "${name}". The profile was downloaded and is not stored on the server.`);
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
          placeholder="Filter by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter clients by name"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
          Show revoked ({revokedCount})
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
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Cert expiry</th>
              <th className="px-4 py-2 font-medium">Real IP</th>
              <th className="px-4 py-2 font-medium">VPN IP</th>
              <th className="px-4 py-2 text-right font-medium">In / Out</th>
              <th className="px-4 py-2 font-medium">Connected</th>
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

      <Modal open={addOpen} title="Add client" onClose={() => setAddOpen(false)}>
        <form onSubmit={onAdd} className="space-y-4">
          <div>
            <label htmlFor="client-name" className="text-sm font-medium">Client name</label>
            <input
              id="client-name"
              autoFocus
              autoComplete="off"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={32}
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="e.g. alice-laptop"
            />
            <p className="mt-1.5 text-xs text-muted">
              1–32 characters: letters, digits, <code>-</code> and <code>_</code>. The .ovpn profile downloads once
              and is never stored by the panel — keep it safe.
            </p>
          </div>
          {error && addOpen ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!nameValid || busy}>
              {busy ? "Creating…" : "Create & download"}
            </Button>
          </div>
        </form>
      </Modal>

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
