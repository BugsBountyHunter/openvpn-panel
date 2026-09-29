import { z } from "zod";
import { HelperError, type HelperRunner } from "../helper";
import { MgmtError, type MgmtClient } from "../mgmt/client";
import { parseKill, parseLoadStats, parseState, parseStatus3, parseVersion, type MgmtClientEntry } from "../mgmt/parse";
import { CLIENT_NAME_PATTERN } from "../names";
import { TtlCache } from "../ttl-cache";
import type { AddOptions, Backend, CertOptions, PkiStatus, ServerStatus, VpnClient } from "../types";

/**
 * Backend for servers installed with angristan/openvpn-install:
 *  - live data and disconnects via the OpenVPN management interface
 *  - certificate operations via the sudo helper (openvpn-install.sh client ...)
 */

const certListSchema = z.object({
  clients: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      expiry: z.string().optional(),
      days_remaining: z.number().nullable().optional(),
    }),
  ),
});

export interface CertRecord {
  name: string;
  status: "active" | "revoked";
  expiry: string | null;
  daysRemaining: number | null;
}

/** Parses `openvpn-install.sh client list --format json` output. */
export function parseCertList(output: string): CertRecord[] {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new HelperError("Helper returned no client list", null);
  let json: unknown;
  try {
    json = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new HelperError("Helper returned malformed JSON", null);
  }
  const parsed = certListSchema.safeParse(json);
  if (!parsed.success) throw new HelperError("Helper returned an unexpected client list", null);
  return parsed.data.clients.map((c) => ({
    name: c.name,
    status: c.status === "valid" ? "active" : "revoked",
    expiry: c.expiry && /^\d{4}-\d{2}-\d{2}$/.test(c.expiry) ? c.expiry : null,
    daysRemaining: c.days_remaining ?? null,
  }));
}

const epochSeconds = z.number().int().positive().nullable();
const pkiSchema = z.object({
  server_cert_not_after: epochSeconds,
  ca_cert_not_after: epochSeconds,
  crl_next_update: epochSeconds,
});

const toMs = (seconds: number | null) => (seconds === null ? null : seconds * 1000);

/** Parses `openvpn-panel-helper pki` output (epoch seconds or null). */
export function parsePki(output: string): PkiStatus {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new HelperError("Helper returned no PKI status", null);
  let json: unknown;
  try {
    json = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new HelperError("Helper returned malformed JSON", null);
  }
  const parsed = pkiSchema.safeParse(json);
  if (!parsed.success) throw new HelperError("Helper returned an unexpected PKI status", null);
  return {
    serverCertExpiresAt: toMs(parsed.data.server_cert_not_after),
    caCertExpiresAt: toMs(parsed.data.ca_cert_not_after),
    crlNextUpdate: toMs(parsed.data.crl_next_update),
  };
}

function assertProfile(output: string): string {
  if (!/^client\s*$/m.test(output)) throw new HelperError("Helper did not return a client profile", null);
  return output;
}

function assertName(name: string): void {
  if (!CLIENT_NAME_PATTERN.test(name)) throw new HelperError("Invalid client name", null);
}

type SessionFields = Pick<VpnClient, "online" | "realIp" | "vpnIp" | "bytesIn" | "bytesOut" | "connectedSince">;

/** Combines possibly-multiple sessions for one CN (duplicate-cn setups). */
function mergeSessions(sessions: MgmtClientEntry[]): SessionFields {
  if (sessions.length === 0) {
    return { online: false, realIp: null, vpnIp: null, bytesIn: 0, bytesOut: 0, connectedSince: null };
  }
  const latest = sessions.reduce((a, b) => ((b.connectedSince ?? 0) > (a.connectedSince ?? 0) ? b : a));
  return {
    online: true,
    realIp: latest.realIp,
    vpnIp: latest.virtualAddress ?? latest.virtualIPv6,
    bytesIn: sessions.reduce((sum, s) => sum + s.bytesReceived, 0),
    bytesOut: sessions.reduce((sum, s) => sum + s.bytesSent, 0),
    connectedSince: latest.connectedSince ? latest.connectedSince * 1000 : null,
  };
}

export function mergeClients(certs: CertRecord[], sessions: MgmtClientEntry[]): VpnClient[] {
  const byName = new Map<string, MgmtClientEntry[]>();
  for (const s of sessions) byName.set(s.commonName, [...(byName.get(s.commonName) ?? []), s]);

  const fromCerts = certs.map((cert): VpnClient => ({
    name: cert.name,
    status: cert.status,
    certExpiry: cert.expiry,
    daysRemaining: cert.daysRemaining,
    ...mergeSessions(byName.get(cert.name) ?? []),
  }));

  // Sessions whose CN is not in the certificate list (should be rare).
  const known = new Set(certs.map((c) => c.name));
  const orphans = [...byName.entries()]
    .filter(([name]) => !known.has(name) && name !== "UNDEF")
    .map(([name, list]): VpnClient => ({
      name,
      status: "active",
      certExpiry: null,
      daysRemaining: null,
      ...mergeSessions(list),
    }));

  return [...fromCerts, ...orphans];
}

export class LiveBackend implements Backend {
  readonly kind = "live";
  private readonly certs: TtlCache<CertRecord[]>;
  private readonly pki: TtlCache<PkiStatus>;
  // The management interface serves one client at a time, so every open tab
  // polling it would queue; a short cache lets them share each read.
  private readonly liveStatus: TtlCache<ServerStatus>;
  private readonly sessions: TtlCache<MgmtClientEntry[]>;

  constructor(
    private readonly mgmt: Pick<MgmtClient, "session">,
    private readonly helper: HelperRunner,
    certCacheMs: number = 15_000,
    /** PKI dates change only on renew/revoke, so a long cache keeps sudo calls rare. */
    pkiCacheMs: number = 10 * 60_000,
    liveCacheMs: number = 2_000,
  ) {
    this.certs = new TtlCache(certCacheMs);
    this.pki = new TtlCache(pkiCacheMs);
    this.liveStatus = new TtlCache(liveCacheMs);
    this.sessions = new TtlCache(liveCacheMs);
  }

  getPki(): Promise<PkiStatus> {
    return this.pki.get(async () => parsePki(await this.helper.run("pki")));
  }

  private listCerts(): Promise<CertRecord[]> {
    return this.certs.get(async () => parseCertList(await this.helper.run("list")));
  }

  private invalidateCerts(): void {
    this.certs.clear();
    // Revoking and renewing regenerate the CRL, so its date may have moved too.
    this.pki.clear();
    this.invalidateLive();
  }

  private invalidateLive(): void {
    this.liveStatus.clear();
    this.sessions.clear();
  }

  private readStatus(): Promise<ServerStatus> {
    return this.liveStatus.get(() =>
      this.mgmt.session(async (s) => {
        const state = parseState(await s.multi("state"));
        const stats = parseLoadStats(await s.single("load-stats"));
        const version = parseVersion(await s.multi("version"));
        return {
          up: true,
          startedAt: state.since ? state.since * 1000 : null,
          connectedCount: stats.nclients,
          bytesIn: stats.bytesIn,
          bytesOut: stats.bytesOut,
          version,
          error: null,
        };
      }),
    );
  }

  private readSessions(): Promise<MgmtClientEntry[]> {
    return this.sessions.get(() =>
      this.mgmt.session(async (s) => parseStatus3((await s.multi("status 3")).join("\n")).clients),
    );
  }

  async getStatus(): Promise<ServerStatus> {
    try {
      return await this.readStatus();
    } catch (error) {
      if (!(error instanceof MgmtError)) throw error;
      return {
        up: false,
        startedAt: null,
        connectedCount: 0,
        bytesIn: 0,
        bytesOut: 0,
        version: null,
        error: error.message,
      };
    }
  }

  async listClients(): Promise<VpnClient[]> {
    const [certs, live] = await Promise.allSettled([this.listCerts(), this.readSessions()]);
    if (certs.status === "rejected") throw certs.reason;
    // If OpenVPN is down we still show certificates, just nobody online.
    const sessions = live.status === "fulfilled" ? live.value : [];
    return mergeClients(certs.value, sessions);
  }

  async addClient(name: string, options?: AddOptions): Promise<string> {
    assertName(name);
    try {
      return assertProfile(await this.helper.run("add", name, options));
    } finally {
      this.invalidateCerts();
    }
  }

  async renewClient(name: string, options?: CertOptions): Promise<string> {
    assertName(name);
    try {
      return assertProfile(await this.helper.run("renew", name, options));
    } finally {
      this.invalidateCerts();
    }
  }

  async revokeClient(name: string): Promise<void> {
    assertName(name);
    try {
      await this.helper.run("revoke", name);
    } finally {
      this.invalidateCerts();
    }
  }

  async disconnectClient(name: string): Promise<boolean> {
    assertName(name);
    try {
      return await this.mgmt.session(async (s) => parseKill(await s.single(`kill ${name}`)));
    } finally {
      this.invalidateLive();
    }
  }
}
