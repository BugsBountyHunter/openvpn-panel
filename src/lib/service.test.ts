import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend, resetDemoState } from "./backend/demo";
import { PanelError, PanelService } from "./service";

describe("PanelService with the demo backend", () => {
  let panel: PanelService;

  beforeEach(() => {
    resetDemoState();
    panel = new PanelService(new DemoBackend());
  });

  it("hides the server certificate", async () => {
    const clients = await panel.listClients();
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.some((c) => c.name.startsWith("server_"))).toBe(false);
  });

  it("sorts online clients first", async () => {
    const clients = await panel.listClients();
    const firstOffline = clients.findIndex((c) => !c.online);
    expect(clients.slice(firstOffline).every((c) => !c.online)).toBe(true);
  });

  it("refuses to revoke or disconnect the server certificate", async () => {
    await expect(panel.revokeClient("server_a1b2c3d4")).rejects.toBeInstanceOf(PanelError);
    await expect(panel.disconnectClient("server_a1b2c3d4")).rejects.toBeInstanceOf(PanelError);
  });

  it("adds a client and returns a profile", async () => {
    const profile = await panel.addClient("new-client");
    expect(profile).toContain("client");
    const clients = await panel.listClients();
    expect(clients.find((c) => c.name === "new-client")?.status).toBe("active");
  });

  it("passes add options to the backend", async () => {
    await panel.addClient("short-lived", { certDays: 30, passphrase: "correct horse" });
    const client = (await panel.listClients()).find((c) => c.name === "short-lived");
    expect(client?.daysRemaining).toBeLessThanOrEqual(30);
  });

  it("rejects duplicate names", async () => {
    await expect(panel.addClient("alice-laptop")).rejects.toMatchObject({ status: 409 });
  });

  it("revokes and disconnects", async () => {
    expect(await panel.disconnectClient("bob-phone")).toBe(true);
    expect(await panel.disconnectClient("bob-phone")).toBe(false);
    await panel.revokeClient("alice-laptop");
    const alice = (await panel.listClients()).find((c) => c.name === "alice-laptop");
    expect(alice).toMatchObject({ status: "revoked", online: false });
    await expect(panel.revokeClient("alice-laptop")).rejects.toMatchObject({ status: 409 });
    await expect(panel.revokeClient("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("renews an active client with a new expiry and returns a profile", async () => {
    const profile = await panel.renewClient("erin-tablet", { certDays: 365 });
    expect(profile).toContain("client");
    const erin = (await panel.listClients()).find((c) => c.name === "erin-tablet");
    expect(erin?.daysRemaining).toBeGreaterThanOrEqual(364);
  });

  it("refuses to renew missing, revoked or server certificates", async () => {
    await expect(panel.renewClient("nobody")).rejects.toMatchObject({ status: 404 });
    await expect(panel.renewClient("dave-old")).rejects.toMatchObject({ status: 409 });
    await expect(panel.renewClient("server_a1b2c3d4")).rejects.toMatchObject({ status: 403 });
  });

  it("reports server status", async () => {
    const status = await panel.getStatus();
    expect(status.up).toBe(true);
    expect(status.connectedCount).toBe((await panel.listClients()).filter((c) => c.online).length);
  });
});
