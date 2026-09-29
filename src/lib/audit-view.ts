import { AUDIT_ACTIONS, type AuditAction, type AuditEntry } from "./audit";

/** Filtering and CSV export for the audit log. Pure; shared by the page and the export route. */

export const AUDIT_RESULTS = ["ok", "failed"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

const MAX_QUERY = 100;

export interface AuditFilter {
  action: AuditAction | null;
  result: AuditResult | null;
  q: string;
  /** Inclusive UTC dates, YYYY-MM-DD. */
  from: string | null;
  to: string | null;
}

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function first(params: RawParams, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function isoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Rejects impossible dates such as 2026-02-31, which Date would roll over.
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : value;
}

/** Lenient: unknown or malformed values are ignored rather than rejected. */
export function parseAuditFilter(params: RawParams): AuditFilter {
  return {
    action: oneOf(first(params, "action"), AUDIT_ACTIONS),
    result: oneOf(first(params, "result"), AUDIT_RESULTS),
    q: first(params, "q").trim().slice(0, MAX_QUERY),
    from: isoDate(first(params, "from")),
    to: isoDate(first(params, "to")),
  };
}

function matches(entry: AuditEntry, filter: AuditFilter, needle: string): boolean {
  if (filter.action && entry.action !== filter.action) return false;
  if (filter.result && entry.ok !== (filter.result === "ok")) return false;
  const day = entry.ts.slice(0, 10);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  if (!needle) return true;
  return [entry.actor, entry.target, entry.ip, entry.detail].some((f) => f?.toLowerCase().includes(needle));
}

export function filterAudit(entries: readonly AuditEntry[], filter: AuditFilter): AuditEntry[] {
  const needle = filter.q.toLowerCase();
  return entries.filter((e) => matches(e, filter, needle));
}

/** Query string (with leading "?") for the set fields, or "" when none are set. */
export function auditFilterQuery(filter: AuditFilter): string {
  const pairs = Object.entries(filter).filter((pair): pair is [string, string] => Boolean(pair[1]));
  return pairs.length ? `?${new URLSearchParams(pairs)}` : "";
}

/**
 * RFC 4180 field. Values that a spreadsheet would treat as a formula are
 * prefixed with a quote, because targets, IPs and actors can be attacker-chosen
 * (e.g. the username on a failed sign-in).
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_HEADER = ["timestamp", "actor", "action", "target", "ip", "result", "detail"];

export function auditToCsv(entries: readonly AuditEntry[]): string {
  const rows = entries.map((e) => [e.ts, e.actor, e.action, e.target ?? "", e.ip ?? "", e.ok ? "ok" : "failed", e.detail ?? ""]);
  return [CSV_HEADER, ...rows].map((row) => `${row.map(csvField).join(",")}\r\n`).join("");
}
