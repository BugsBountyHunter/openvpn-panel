import { describe, expect, it } from "vitest";
import { countByStatus, matchesQuery, matchesStatus, nextSort, selectClients, sortClients } from "./client-view";
import type { VpnClient } from "./types";

function client(overrides: Partial<VpnClient> & { name: string }): VpnClient {
  return {
    status: "active",
    certExpiry: "2030-01-01",
    daysRemaining: 1000,
    online: false,
    realIp: null,
    vpnIp: null,
    bytesIn: 0,
    bytesOut: 0,
    connectedSince: null,
    ...overrides,
  };
}

const alice = client({
  name: "alice",
  online: true,
  realIp: "203.0.113.7",
  vpnIp: "10.8.0.2",
  bytesIn: 100,
  bytesOut: 50,
  connectedSince: 2_000,
});
const bob = client({ name: "bob", daysRemaining: 10, certExpiry: "2026-10-09" });
const carol = client({ name: "carol", status: "revoked", daysRemaining: null, certExpiry: null });
const dave = client({ name: "Dave", online: true, vpnIp: "10.8.0.3", bytesIn: 5_000, connectedSince: 1_000 });
const erin = client({ name: "erin", daysRemaining: -3, certExpiry: "2026-09-26" });
const all = [alice, bob, carol, dave, erin];

const names = (list: VpnClient[]) => list.map((c) => c.name);

describe("matchesStatus", () => {
  it.each([
    ["active", ["alice", "bob", "Dave", "erin"]],
    ["online", ["alice", "Dave"]],
    ["offline", ["bob", "erin"]],
    ["expiring", ["bob", "erin"]],
    ["revoked", ["carol"]],
    ["all", ["alice", "bob", "carol", "Dave", "erin"]],
  ] as const)("%s", (filter, expected) => {
    expect(names(all.filter((c) => matchesStatus(c, filter)))).toEqual(expected);
  });

  it("does not count revoked certificates as expiring", () => {
    expect(matchesStatus(client({ name: "x", status: "revoked", daysRemaining: 5 }), "expiring")).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("matches everything for a blank query", () => {
    expect(matchesQuery(bob, "  ")).toBe(true);
  });

  it("matches name case-insensitively", () => {
    expect(matchesQuery(dave, "dav")).toBe(true);
    expect(matchesQuery(dave, "ALI")).toBe(false);
  });

  it("matches real and VPN addresses", () => {
    expect(matchesQuery(alice, "203.0.113")).toBe(true);
    expect(matchesQuery(alice, "10.8.0.2")).toBe(true);
    expect(matchesQuery(bob, "10.8")).toBe(false);
  });
});

describe("sortClients", () => {
  it("defaults to online first, then active, then by name", () => {
    expect(names(sortClients(all, null))).toEqual(["alice", "Dave", "bob", "erin", "carol"]);
  });

  it("sorts by name in both directions", () => {
    expect(names(sortClients(all, { key: "name", dir: "asc" }))).toEqual(["alice", "bob", "carol", "Dave", "erin"]);
    expect(names(sortClients(all, { key: "name", dir: "desc" }))).toEqual(["erin", "Dave", "carol", "bob", "alice"]);
  });

  it("sorts by expiry with unknown expiry always last", () => {
    expect(names(sortClients(all, { key: "expiry", dir: "asc" }))).toEqual(["erin", "bob", "alice", "Dave", "carol"]);
    expect(names(sortClients(all, { key: "expiry", dir: "desc" }))).toEqual(["alice", "Dave", "bob", "erin", "carol"]);
  });

  it("sorts by total traffic", () => {
    expect(names(sortClients(all, { key: "traffic", dir: "desc" })).slice(0, 2)).toEqual(["Dave", "alice"]);
  });

  it("sorts by connection duration with offline clients last", () => {
    // Dave connected earlier (1_000) than alice (2_000), so his session is longer.
    expect(names(sortClients(all, { key: "connected", dir: "desc" })).slice(0, 2)).toEqual(["Dave", "alice"]);
    expect(names(sortClients(all, { key: "connected", dir: "asc" }))).toEqual(["alice", "Dave", "bob", "carol", "erin"]);
  });

  it("sorts by status rank", () => {
    expect(names(sortClients(all, { key: "status", dir: "desc" }))[0]).toBe("carol");
  });

  it("does not mutate the input", () => {
    const input = [bob, alice];
    sortClients(input, { key: "name", dir: "asc" });
    expect(names(input)).toEqual(["bob", "alice"]);
  });
});

describe("selectClients", () => {
  it("applies status, query and sort together", () => {
    const result = selectClients(all, { status: "active", query: "e", sort: { key: "name", dir: "desc" } });
    expect(names(result)).toEqual(["erin", "Dave", "alice"]);
  });
});

describe("nextSort", () => {
  it("cycles asc -> desc -> default, and restarts on a new column", () => {
    const asc = nextSort(null, "name");
    expect(asc).toEqual({ key: "name", dir: "asc" });
    const desc = nextSort(asc, "name");
    expect(desc).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(desc, "name")).toBeNull();
    expect(nextSort(desc, "expiry")).toEqual({ key: "expiry", dir: "asc" });
  });
});

describe("countByStatus", () => {
  it("counts every filter", () => {
    expect(countByStatus(all)).toEqual({ active: 4, online: 2, offline: 2, expiring: 2, revoked: 1, all: 5 });
  });
});
