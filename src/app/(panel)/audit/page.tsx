import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { AUDIT_ACTIONS, readAudit, type AuditAction } from "@/lib/audit";
import { auditFilterQuery, filterAudit, parseAuditFilter, type AuditFilter } from "@/lib/audit-view";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Entries scanned for filtering (bounded by readAudit's tail read). */
const SCAN_LIMIT = 50_000;
/** Rows rendered; the CSV export has no such cap. */
const DISPLAY_LIMIT = 500;

const LABELS: Record<AuditAction, string> = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  logout: "Signed out",
  add: "Added client",
  revoke: "Revoked client",
  disconnect: "Disconnected client",
  audit_export: "Exported audit log",
};

const FIELD = "rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent";
const BUTTON = "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition";

function isFiltered(filter: AuditFilter): boolean {
  return auditFilterQuery(filter) !== "";
}

function FilterBar({ filter }: { filter: AuditFilter }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3" aria-label="Filter audit log">
      <input
        type="search"
        name="q"
        defaultValue={filter.q}
        maxLength={100}
        placeholder="Search user, target, IP"
        aria-label="Search audit log"
        className={`${FIELD} min-w-0 flex-1 sm:max-w-xs`}
      />
      <select name="action" defaultValue={filter.action ?? ""} aria-label="Action" className={FIELD}>
        <option value="">All actions</option>
        {AUDIT_ACTIONS.map((action) => (
          <option key={action} value={action}>{LABELS[action]}</option>
        ))}
      </select>
      <select name="result" defaultValue={filter.result ?? ""} aria-label="Result" className={FIELD}>
        <option value="">Any result</option>
        <option value="ok">ok</option>
        <option value="failed">failed</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        From
        <input type="date" name="from" defaultValue={filter.from ?? ""} className={FIELD} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        To
        <input type="date" name="to" defaultValue={filter.to ?? ""} className={FIELD} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={`${BUTTON} bg-accent text-accent-fg hover:opacity-90`}>Apply</button>
        {isFiltered(filter) ? (
          <Link href="/audit" className={`${BUTTON} text-muted hover:bg-surface-2 hover:text-text`}>Reset</Link>
        ) : null}
      </div>
    </form>
  );
}

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const filter = parseAuditFilter(await searchParams);
  const matching = filterAudit(await readAudit(getConfig().auditLogPath, SCAN_LIMIT), filter);
  const entries = matching.slice(0, DISPLAY_LIMIT);
  const title = isFiltered(filter)
    ? `${matching.length} matching event${matching.length === 1 ? "" : "s"}`
    : `Latest ${entries.length} events`;
  const exportLink = (
    <a href={`/api/audit/export${auditFilterQuery(filter)}`} download className="text-sm text-accent">
      Export CSV
    </a>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <Card title={title} actions={exportLink}>
        <FilterBar filter={filter} />
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {isFiltered(filter) ? "No events match these filters." : "No events recorded yet."}
          </p>
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
        {matching.length > entries.length ? (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            Showing the newest {entries.length} of {matching.length}. Export CSV for all of them.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
