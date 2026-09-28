import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HelperRunner, HelperVerb } from "../helper";
import { MgmtError, type MgmtClient, type MgmtSession } from "../mgmt/client";
import { LiveBackend, parseCertList, parsePki } from "./live";

const fixture = (name: string) => readFileSync(join(__dirname, "../../../test/fixtures", name), "utf8");
const STATUS3_LINES = fixture("status3.txt").split(/\r?\n/).filter((l) => l && l !== "END");
const CLIENT_LIST = fixture("client-list.json");

function fakeMgmt(replies: Record<string, string | string[]>, fail = false): Pick<MgmtClient, "session"> & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    session: async <T>(fn: (s: MgmtSession) => Promise<T>): Promise<T> => {
      if (fail) throw new MgmtError("Cannot reach the management interface: ECONNREFUSED");
      const reply = (cmd: string) => {
        sent.push(cmd);
        return replies[cmd];
      };
      return fn({
        single: async (cmd) => reply(cmd) as string,
        multi: async (cmd) => reply(cmd) as string[],
      });
    },
  };
}

function fakeHelper(outputs: Partial<Record<HelperVerb, string>>): HelperRunner & { calls: Array<[HelperVerb, string?]> } {
  const calls: Array<[HelperVerb, string?]> = [];
  return {
    calls,
    run: vi.fn(async (verb: HelperVerb, name?: string) => {
      calls.push([verb, name]);
      const out = outputs[verb];
      if (out === undefined) throw new Error(`unexpected ${verb}`);
      return out;
    }),
  };
}

const MGMT_REPLIES = {
  "status 3": STATUS3_LINES,
  state: ["1790331669,CONNECTED,SUCCESS,10.8.0.1,,,,"],
  "load-stats": "SUCCESS: nclients=3,bytesin=5000,bytesout=9000",
  version: ["OpenVPN Version: OpenVPN 2.6.14 x86_64-pc-linux-gnu", "Management Version: 5"],
  "kill alice-laptop": "SUCCESS: common name 'alice-laptop' found, 1 client(s) killed",
  "kill bob-phone": "ERROR: common name 'bob-phone' not found",
};

describe("parseCertList", () => {
  it("maps installer JSON to cert records", () => {
    const certs = parseCertList(CLIENT_LIST);
    expect(certs).toHaveLength(4);
    expect(certs[0]).toEqual({ name: "alice-laptop", status: "active", expiry: "2036-02-09", daysRemaining: 3421 });
    expect(certs[2].status).toBe("revoked");
    expect(certs[3]).toMatchObject({ expiry: null, daysRemaining: null });
  });

  it("tolerates noise around the JSON and rejects garbage", () => {
    expect(parseCertList(`warning: something\n${CLIENT_LIST}`)).toHaveLength(4);
    expect(parseCertList('{"clients":[]}')).toEqual([]);
    expect(() => parseCertList("nope")).toThrow();
    expect(() => parseCertList('{"foo":1}')).toThrow();
  });
});

describe("parsePki", () => {
  it("converts epoch seconds to milliseconds and keeps nulls", () => {
    expect(parsePki('{"server_cert_not_after":2081234567,"ca_cert_not_after":null,"crl_next_update":1790000000}')).toEqual({
      serverCertExpiresAt: 2_081_234_567_000,
      caCertExpiresAt: null,
      crlNextUpdate: 1_790_000_000_000,
    });
  });

  it("rejects malformed output", () => {
    expect(() => parsePki("nope")).toThrow(/no PKI status/);
    expect(() => parsePki('{"server_cert_not_after":"soon"}')).toThrow(/unexpected PKI status/);
  });
});

describe("LiveBackend", () => {
  it("reports server status from the management interface", async () => {
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), fakeHelper({}));
    expect(await backend.getStatus()).toEqual({
      up: true,
      startedAt: 1790331669000,
      connectedCount: 3,
      bytesIn: 5000,
      bytesOut: 9000,
      version: "OpenVPN 2.6.14",
      error: null,
    });
  });

  it("reports down when the management interface is unreachable", async () => {
    const backend = new LiveBackend(fakeMgmt({}, true), fakeHelper({}));
    const status = await backend.getStatus();
    expect(status.up).toBe(false);
    expect(status.error).toMatch(/ECONNREFUSED/);
  });

  it("merges certificates with live sessions", async () => {
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), fakeHelper({ list: CLIENT_LIST }));
    const clients = await backend.listClients();
    const alice = clients.find((c) => c.name === "alice-laptop");
    expect(alice).toMatchObject({
      status: "active",
      online: true,
      realIp: "203.0.113.24",
      vpnIp: "10.8.0.2",
      bytesIn: 1843221,
      bytesOut: 20918311,
      connectedSince: 1790586131000,
      certExpiry: "2036-02-09",
    });
    expect(clients.find((c) => c.name === "dave-old")).toMatchObject({ status: "revoked", online: false });
    // ci-runner is connected but missing from the cert list: still shown.
    expect(clients.find((c) => c.name === "ci-runner")).toMatchObject({ online: true, certExpiry: null });
  });

  it("still lists certificates when OpenVPN is down", async () => {
    const backend = new LiveBackend(fakeMgmt({}, true), fakeHelper({ list: CLIENT_LIST }));
    const clients = await backend.listClients();
    expect(clients).toHaveLength(4);
    expect(clients.every((c) => !c.online)).toBe(true);
  });

  it("caches the certificate list and invalidates it after changes", async () => {
    const helper = fakeHelper({ list: CLIENT_LIST, revoke: "", add: "client\ndev tun\n<ca>\n</ca>\n" });
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), helper);
    await backend.listClients();
    await backend.listClients();
    expect(helper.calls.filter(([v]) => v === "list")).toHaveLength(1);
    await backend.revokeClient("bob-phone");
    await backend.listClients();
    expect(helper.calls.filter(([v]) => v === "list")).toHaveLength(2);
  });

  it("returns the profile from the helper on add", async () => {
    const helper = fakeHelper({ add: "client\ndev tun\n<ca>\nX\n</ca>\n" });
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), helper);
    expect(await backend.addClient("new-one")).toContain("<ca>");
    expect(helper.calls).toContainEqual(["add", "new-one"]);
  });

  it("rejects helper output that is not a profile", async () => {
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), fakeHelper({ add: "oops" }));
    await expect(backend.addClient("new-one")).rejects.toThrow(/profile/);
  });

  it("disconnects via kill and reports whether a session was found", async () => {
    const mgmt = fakeMgmt(MGMT_REPLIES);
    const backend = new LiveBackend(mgmt, fakeHelper({}));
    expect(await backend.disconnectClient("alice-laptop")).toBe(true);
    expect(await backend.disconnectClient("bob-phone")).toBe(false);
    expect(mgmt.sent).toEqual(["kill alice-laptop", "kill bob-phone"]);
  });

  it("validates names before touching helper or management", async () => {
    const helper = fakeHelper({});
    const mgmt = fakeMgmt(MGMT_REPLIES);
    const backend = new LiveBackend(mgmt, helper);
    await expect(backend.addClient("bad name")).rejects.toThrow();
    await expect(backend.revokeClient("x;y")).rejects.toThrow();
    await expect(backend.disconnectClient("a\nb")).rejects.toThrow();
    expect(helper.calls).toEqual([]);
    expect(mgmt.sent).toEqual([]);
  });

  it("reads PKI dates through the helper and caches them", async () => {
    const helper = fakeHelper({ pki: '{"server_cert_not_after":2081234567,"ca_cert_not_after":2081234567,"crl_next_update":null}' });
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), helper);
    const first = await backend.getPki();
    expect(first.crlNextUpdate).toBeNull();
    await backend.getPki();
    expect(helper.calls).toEqual([["pki", undefined]]);
  });

  it("does not cache a failed PKI read", async () => {
    const helper = fakeHelper({});
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), helper);
    await expect(backend.getPki()).rejects.toThrow();
    await expect(backend.getPki()).rejects.toThrow();
    expect(helper.calls).toHaveLength(2);
  });

  it("renews through the helper, returns the new profile and refreshes the certificate list", async () => {
    const helper = fakeHelper({ list: CLIENT_LIST, renew: "client\ndev tun\n" });
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), helper);
    await backend.listClients();
    expect(await backend.renewClient("alice-laptop", { certDays: 90 })).toContain("client");
    await backend.listClients();
    expect(helper.calls.filter(([verb]) => verb === "list")).toHaveLength(2);
    expect(helper.run).toHaveBeenCalledWith("renew", "alice-laptop", { certDays: 90 });
  });

  it("rejects renew output that is not a profile", async () => {
    const backend = new LiveBackend(fakeMgmt(MGMT_REPLIES), fakeHelper({ renew: "oops" }));
    await expect(backend.renewClient("alice-laptop")).rejects.toThrow(/profile/);
  });
});
