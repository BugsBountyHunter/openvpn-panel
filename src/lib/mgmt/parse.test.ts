import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractIp, parseKill, parseLoadStats, parseState, parseStatus3, parseVersion } from "./parse";

const fixture = (name: string) => readFileSync(join(__dirname, "../../../test/fixtures", name), "utf8");

describe("parseStatus3", () => {
  const snapshot = parseStatus3(fixture("status3.txt"));

  it("reads title and time", () => {
    expect(snapshot.title).toMatch(/^OpenVPN 2\.6\.14/);
    expect(snapshot.time).toBe(1790590502);
  });

  it("parses every CLIENT_LIST row using HEADER columns", () => {
    expect(snapshot.clients.map((c) => c.commonName)).toEqual(["alice-laptop", "bob-phone", "ci-runner"]);
    expect(snapshot.clients[0]).toEqual({
      commonName: "alice-laptop",
      realAddress: "203.0.113.24:51234",
      realIp: "203.0.113.24",
      virtualAddress: "10.8.0.2",
      virtualIPv6: "fd42:42:42:42::1000",
      bytesReceived: 1843221,
      bytesSent: 20918311,
      connectedSince: 1790586131,
      clientId: "4",
    });
  });

  it("handles IPv6 and protocol-prefixed real addresses", () => {
    expect(snapshot.clients[1].realIp).toBe("2001:db8::7");
    expect(snapshot.clients[1].virtualIPv6).toBeNull();
    expect(snapshot.clients[2].realIp).toBe("198.51.100.10");
  });

  it("parses routing table and global stats", () => {
    expect(snapshot.routes).toHaveLength(3);
    expect(snapshot.routes[0]).toMatchObject({ virtualAddress: "10.8.0.2", commonName: "alice-laptop", lastRef: 1790590501 });
    expect(snapshot.globalStats).toEqual({ "Max bcast/mcast queue length": "3", dco_enabled: "1" });
  });

  it("falls back to default columns when HEADER lines are absent", () => {
    const legacy = parseStatus3(fixture("status3-noheader.txt"));
    expect(legacy.clients).toHaveLength(1);
    expect(legacy.clients[0]).toMatchObject({ commonName: "legacy", realIp: "192.0.2.5", bytesSent: 20 });
  });

  it("returns an empty snapshot for no clients", () => {
    const empty = parseStatus3("TITLE\tOpenVPN\nTIME\tx\t1\nEND\n");
    expect(empty.clients).toEqual([]);
    expect(empty.routes).toEqual([]);
  });
});

describe("extractIp", () => {
  it.each([
    ["203.0.113.4:51234", "203.0.113.4"],
    ["[2001:db8::1]:1194", "2001:db8::1"],
    ["tcp6-server:[2001:db8::2]:443", "2001:db8::2"],
    ["udp4:198.51.100.2:1194", "198.51.100.2"],
    ["garbage", null],
  ])("%s -> %s", (input, expected) => {
    expect(extractIp(input)).toBe(expected);
  });
});

describe("small replies", () => {
  it("parses load-stats", () => {
    expect(parseLoadStats("SUCCESS: nclients=3,bytesin=1000,bytesout=2500")).toEqual({
      nclients: 3,
      bytesIn: 1000,
      bytesOut: 2500,
    });
  });

  it("parses state using the latest line", () => {
    expect(parseState(["1790331669,CONNECTED,SUCCESS,10.8.0.1,,,,"])).toEqual({ since: 1790331669, state: "CONNECTED" });
    expect(parseState([])).toEqual({ since: null, state: null });
  });

  it("parses version", () => {
    expect(
      parseVersion(["OpenVPN Version: OpenVPN 2.6.14 x86_64-pc-linux-gnu [SSL (OpenSSL)]", "Management Version: 5"]),
    ).toBe("OpenVPN 2.6.14");
    expect(parseVersion(["nothing"])).toBeNull();
  });

  it("parses kill replies", () => {
    expect(parseKill("SUCCESS: common name 'alice' found, 1 client(s) killed")).toBe(true);
    expect(parseKill("ERROR: common name 'alice' not found")).toBe(false);
  });
});
