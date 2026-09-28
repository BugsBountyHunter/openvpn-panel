export type MgmtAddress =
  | { kind: "unix"; path: string }
  | { kind: "tcp"; host: string; port: number };

/**
 * Parses OVPN_MGMT values of the form `unix:/path/to.sock` or `tcp:host:port`
 * (IPv6 hosts may be bracketed: `tcp:[::1]:7505`).
 */
export function parseMgmtAddress(value: string): MgmtAddress {
  if (value.startsWith("unix:")) {
    const path = value.slice("unix:".length);
    if (!path.startsWith("/")) {
      throw new Error("OVPN_MGMT unix path must be absolute");
    }
    return { kind: "unix", path };
  }
  if (value.startsWith("tcp:")) {
    const match = /^tcp:(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(value);
    if (!match) throw new Error("OVPN_MGMT must look like tcp:host:port");
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error("OVPN_MGMT port out of range");
    const host = match[1].replace(/^\[|\]$/g, "");
    return { kind: "tcp", host, port };
  }
  throw new Error("OVPN_MGMT must start with unix: or tcp:");
}
