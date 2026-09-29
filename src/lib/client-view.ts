import type { VpnClient } from "./types";

/** Pure filtering and sorting for the clients table. */

export const EXPIRY_WARNING_DAYS = 30;

export const STATUS_FILTERS = ["active", "online", "offline", "expiring", "revoked", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORT_KEYS = ["name", "status", "expiry", "traffic", "connected"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export interface ClientView {
  status: StatusFilter;
  query: string;
  /** null keeps the default order: online first, then active, then by name. */
  sort: SortState | null;
}

export function isExpiringSoon(client: VpnClient): boolean {
  return client.status === "active" && client.daysRemaining !== null && client.daysRemaining <= EXPIRY_WARNING_DAYS;
}

export function matchesStatus(client: VpnClient, filter: StatusFilter): boolean {
  switch (filter) {
    case "active":
      return client.status === "active";
    case "online":
      return client.online;
    case "offline":
      return client.status === "active" && !client.online;
    case "expiring":
      return isExpiringSoon(client);
    case "revoked":
      return client.status === "revoked";
    case "all":
      return true;
  }
}

export function matchesQuery(client: VpnClient, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [client.name, client.realIp, client.vpnIp].some((field) => field?.toLowerCase().includes(q));
}

function statusRank(client: VpnClient): number {
  if (client.online) return 0;
  return client.status === "active" ? 1 : 2;
}

/** Sort value for a key; null sorts last in either direction. */
function sortValue(client: VpnClient, key: Exclude<SortKey, "name">): number | null {
  switch (key) {
    case "status":
      return statusRank(client);
    case "expiry":
      return client.daysRemaining;
    case "traffic":
      return client.bytesIn + client.bytesOut;
    case "connected":
      // Longer session = earlier start, so negate to sort by duration.
      return client.connectedSince === null ? null : -client.connectedSince;
  }
}

const byName = (a: VpnClient, b: VpnClient) => a.name.localeCompare(b.name);

function compareBy(sort: SortState): (a: VpnClient, b: VpnClient) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.key === "name") return (a, b) => sign * byName(a, b);
  const key = sort.key;
  return (a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      return byName(a, b);
    }
    return sign * (left - right) || byName(a, b);
  };
}

const defaultCompare = (a: VpnClient, b: VpnClient) => statusRank(a) - statusRank(b) || byName(a, b);

export function sortClients(clients: readonly VpnClient[], sort: SortState | null): VpnClient[] {
  return clients.toSorted(sort ? compareBy(sort) : defaultCompare);
}

export function selectClients(clients: readonly VpnClient[], view: ClientView): VpnClient[] {
  const filtered = clients.filter((c) => matchesStatus(c, view.status) && matchesQuery(c, view.query));
  return sortClients(filtered, view.sort);
}

export function countByStatus(clients: readonly VpnClient[]): Record<StatusFilter, number> {
  return Object.fromEntries(
    STATUS_FILTERS.map((filter) => [filter, clients.filter((c) => matchesStatus(c, filter)).length]),
  ) as Record<StatusFilter, number>;
}

/** Clicking a header: new column sorts ascending, same column flips, third click resets. */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}
