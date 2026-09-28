import { isIP } from "node:net";

/** Parsers for OpenVPN management interface responses. */

export interface MgmtClientEntry {
  commonName: string;
  realAddress: string;
  realIp: string | null;
  virtualAddress: string | null;
  virtualIPv6: string | null;
  bytesReceived: number;
  bytesSent: number;
  /** Epoch seconds. */
  connectedSince: number | null;
  clientId: string | null;
}

export interface RoutingEntry {
  virtualAddress: string;
  commonName: string;
  realAddress: string;
  /** Epoch seconds. */
  lastRef: number | null;
}

export interface StatusSnapshot {
  title: string | null;
  /** Epoch seconds from the TIME line. */
  time: number | null;
  clients: MgmtClientEntry[];
  routes: RoutingEntry[];
  globalStats: Record<string, string>;
}

// Column layout of OpenVPN 2.5/2.6, used if a HEADER line is missing.
const DEFAULT_HEADERS: Record<string, string[]> = {
  CLIENT_LIST: [
    "Common Name", "Real Address", "Virtual Address", "Virtual IPv6 Address", "Bytes Received", "Bytes Sent",
    "Connected Since", "Connected Since (time_t)", "Username", "Client ID", "Peer ID", "Data Channel Cipher",
  ],
  ROUTING_TABLE: ["Virtual Address", "Common Name", "Real Address", "Last Ref", "Last Ref (time_t)"],
};

function toInt(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function toEpoch(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function emptyToNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Extracts the IP from OpenVPN "Real Address" values such as
 * `203.0.113.4:51234`, `[2001:db8::1]:1194`, `udp4:198.51.100.2:1194`,
 * or `tcp6-server:[2001:db8::2]:443`. Returns null when no IP can be found.
 */
export function extractIp(realAddress: string): string | null {
  let value = realAddress.trim().replace(/^\[AF_INET6?\]/, "");
  value = value.replace(/^(?:udp|tcp)[46]?(?:-server|-client)?:/, "");
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return isIP(bracketed[1]) ? bracketed[1] : null;
  if (isIP(value)) return value;
  const withPort = /^(.*):(\d{1,5})$/.exec(value);
  if (withPort && isIP(withPort[1])) return withPort[1];
  return null;
}

function rowToRecord(headers: string[], fields: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((h, i) => [h, fields[i] ?? ""]));
}

/** Parses the tab-separated output of `status 3` (lines up to, not including, END). */
export function parseStatus3(text: string): StatusSnapshot {
  const headers: Record<string, string[]> = { ...DEFAULT_HEADERS };
  const clients: MgmtClientEntry[] = [];
  const routes: RoutingEntry[] = [];
  const globalStats: Record<string, string> = {};
  let title: string | null = null;
  let time: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line === "END") continue;
    const [kind, ...fields] = line.split("\t");
    switch (kind) {
      case "TITLE":
        title = fields.join("\t") || null;
        break;
      case "TIME":
        time = toEpoch(fields[1]);
        break;
      case "HEADER":
        if (fields[0]) headers[fields[0]] = fields.slice(1);
        break;
      case "CLIENT_LIST": {
        const r = rowToRecord(headers.CLIENT_LIST, fields);
        const realAddress = r["Real Address"] ?? "";
        clients.push({
          commonName: r["Common Name"] ?? "",
          realAddress,
          realIp: extractIp(realAddress),
          virtualAddress: emptyToNull(r["Virtual Address"]),
          virtualIPv6: emptyToNull(r["Virtual IPv6 Address"]),
          bytesReceived: toInt(r["Bytes Received"]),
          bytesSent: toInt(r["Bytes Sent"]),
          connectedSince: toEpoch(r["Connected Since (time_t)"]),
          clientId: emptyToNull(r["Client ID"]),
        });
        break;
      }
      case "ROUTING_TABLE": {
        const r = rowToRecord(headers.ROUTING_TABLE, fields);
        routes.push({
          virtualAddress: r["Virtual Address"] ?? "",
          commonName: r["Common Name"] ?? "",
          realAddress: r["Real Address"] ?? "",
          lastRef: toEpoch(r["Last Ref (time_t)"]),
        });
        break;
      }
      case "GLOBAL_STATS":
        if (fields[0]) globalStats[fields[0]] = fields[1] ?? "";
        break;
      default:
        break;
    }
  }
  return { title, time, clients, routes, globalStats };
}

export interface LoadStats {
  nclients: number;
  bytesIn: number;
  bytesOut: number;
}

/** `SUCCESS: nclients=2,bytesin=1234,bytesout=5678` */
export function parseLoadStats(line: string): LoadStats {
  const body = line.replace(/^SUCCESS:\s*/, "");
  const values = Object.fromEntries(
    body.split(",").map((pair) => {
      const [k, v] = pair.split("=");
      return [k.trim(), v?.trim()];
    }),
  );
  return { nclients: toInt(values.nclients), bytesIn: toInt(values.bytesin), bytesOut: toInt(values.bytesout) };
}

export interface ServerState {
  /** Epoch seconds when the current state was entered. */
  since: number | null;
  state: string | null;
}

/** Lines of `state` output, e.g. `1790331669,CONNECTED,SUCCESS,10.8.0.1,,,,`. Uses the latest. */
export function parseState(lines: string[]): ServerState {
  const last = lines.filter((l) => /^\d+,/.test(l)).at(-1);
  if (!last) return { since: null, state: null };
  const [time, state] = last.split(",");
  return { since: toEpoch(time), state: state || null };
}

/** `OpenVPN Version: OpenVPN 2.6.14 x86_64-pc-linux-gnu [SSL ...]` -> `OpenVPN 2.6.14` */
export function parseVersion(lines: string[]): string | null {
  for (const line of lines) {
    const match = /^OpenVPN Version:\s*(OpenVPN\s+\S+)/.exec(line);
    if (match) return match[1];
  }
  return null;
}

/** `SUCCESS: common name 'x' found, 1 client(s) killed` -> true; `ERROR: ... not found` -> false. */
export function parseKill(line: string): boolean {
  return line.startsWith("SUCCESS:");
}
