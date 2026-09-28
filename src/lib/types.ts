/** Overall health of the OpenVPN server process. */
export interface ServerStatus {
  up: boolean;
  /** Epoch milliseconds when the server entered its current state, if known. */
  startedAt: number | null;
  connectedCount: number;
  /** Aggregate bytes received by the server since start. */
  bytesIn: number;
  /** Aggregate bytes sent by the server since start. */
  bytesOut: number;
  version: string | null;
  /** Human-readable reason when `up` is false or data is partial. */
  error: string | null;
}

export type CertStatus = "active" | "revoked";

/** A client certificate merged with its live session (if connected). */
export interface VpnClient {
  name: string;
  status: CertStatus;
  /** ISO date (YYYY-MM-DD) of certificate expiry, if known. */
  certExpiry: string | null;
  daysRemaining: number | null;
  online: boolean;
  /** Public address the client connects from (without port). */
  realIp: string | null;
  vpnIp: string | null;
  /** Bytes received by the server from this client. */
  bytesIn: number;
  /** Bytes sent by the server to this client. */
  bytesOut: number;
  /** Epoch milliseconds the current session started. */
  connectedSince: number | null;
}

/**
 * Data source abstraction. Implementations exist for demo data and for
 * angristan/openvpn-install servers; other installers can add their own.
 */
export interface Backend {
  readonly kind: string;
  getStatus(): Promise<ServerStatus>;
  listClients(): Promise<VpnClient[]>;
  /** Creates a client and returns the .ovpn profile. Never persist it. */
  addClient(name: string): Promise<string>;
  revokeClient(name: string): Promise<void>;
  /** Returns true when a live session was found and killed. */
  disconnectClient(name: string): Promise<boolean>;
}
