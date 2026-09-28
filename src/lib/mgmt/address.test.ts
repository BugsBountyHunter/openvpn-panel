import { describe, expect, it } from "vitest";
import { parseMgmtAddress } from "./address";

describe("parseMgmtAddress", () => {
  it("parses unix sockets", () => {
    expect(parseMgmtAddress("unix:/run/openvpn-server/server.sock")).toEqual({
      kind: "unix",
      path: "/run/openvpn-server/server.sock",
    });
  });

  it("parses tcp host:port including bracketed IPv6", () => {
    expect(parseMgmtAddress("tcp:127.0.0.1:7505")).toEqual({ kind: "tcp", host: "127.0.0.1", port: 7505 });
    expect(parseMgmtAddress("tcp:[::1]:7505")).toEqual({ kind: "tcp", host: "::1", port: 7505 });
  });

  it.each(["unix:relative.sock", "tcp:host", "tcp:host:99999", "http://x", ""])("rejects %j", (value) => {
    expect(() => parseMgmtAddress(value)).toThrow();
  });
});
