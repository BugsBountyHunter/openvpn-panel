import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MgmtClient, MgmtError } from "./client";
import { parseStatus3 } from "./parse";

const STATUS3 = readFileSync(join(__dirname, "../../../test/fixtures/status3.txt"), "utf8");
const BANNER = ">INFO:OpenVPN Management Interface Version 5 -- type 'help' for more info\r\n";

interface FakeServer {
  server: Server;
  commands: string[];
  maxConcurrent: number;
}

/** Emulates the OpenVPN management interface closely enough for the client. */
function fakeMgmt(opts: { banner?: string | null; delayMs?: number } = {}): FakeServer {
  const state: FakeServer = { server: createServer(), commands: [], maxConcurrent: 0 };
  let open = 0;
  state.server.on("connection", (socket: Socket) => {
    open += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, open);
    socket.on("close", () => (open -= 1));
    if (opts.banner !== null) socket.write(opts.banner ?? BANNER);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.map((l) => l.trim())) {
        state.commands.push(line);
        const reply = () => {
          // Real servers interleave async notifications; the client must skip them.
          socket.write(">BYTECOUNT_CLI:4,100,200\r\n");
          if (line === "status 3") socket.write(STATUS3);
          else if (line === "load-stats") socket.write("SUCCESS: nclients=3,bytesin=100,bytesout=200\r\n");
          else if (line === "state") socket.write("1790331669,CONNECTED,SUCCESS,10.8.0.1,,,,\r\nEND\r\n");
          else if (line === "kill alice-laptop") socket.write("SUCCESS: common name 'alice-laptop' found, 1 client(s) killed\r\n");
          else if (line.startsWith("kill ")) socket.write(`ERROR: common name '${line.slice(5)}' not found\r\n`);
          else if (line === "quit") socket.end();
          else socket.write("ERROR: unknown command, enter 'help' for more options\r\n");
        };
        if (opts.delayMs) setTimeout(reply, opts.delayMs);
        else reply();
      }
    });
  });
  return state;
}

const servers: Server[] = [];
const dirs: string[] = [];

async function listenTcp(fake: FakeServer): Promise<number> {
  servers.push(fake.server);
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  return (fake.server.address() as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe("MgmtClient", () => {
  it("runs status 3 over TCP and skips notifications", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    const lines = await client.session((s) => s.multi("status 3"));
    const snapshot = parseStatus3(lines.join("\n"));
    expect(snapshot.clients).toHaveLength(3);
    expect(lines.some((l) => l.startsWith(">"))).toBe(false);
  });

  it("works over a unix socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mgmt-"));
    dirs.push(dir);
    const path = join(dir, "server.sock");
    const fake = fakeMgmt();
    servers.push(fake.server);
    await new Promise<void>((resolve) => fake.server.listen(path, resolve));
    const client = new MgmtClient({ address: { kind: "unix", path } });
    expect(await client.session((s) => s.single("load-stats"))).toMatch(/^SUCCESS: nclients=3/);
  });

  it("returns kill results without throwing on ERROR", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    expect(await client.session((s) => s.single("kill alice-laptop"))).toMatch(/^SUCCESS/);
    expect(await client.session((s) => s.single("kill nobody"))).toMatch(/^ERROR/);
  });

  it("throws on ERROR replies to block commands", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    await expect(client.session((s) => s.multi("bogus"))).rejects.toBeInstanceOf(MgmtError);
  });

  it("serializes concurrent sessions to a single connection at a time", async () => {
    const fake = fakeMgmt({ delayMs: 20 });
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.session((s) => s.single("load-stats"))),
    );
    expect(results).toHaveLength(5);
    expect(fake.maxConcurrent).toBe(1);
  });

  it("keeps working after a failed session", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    await expect(client.session(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await client.session((s) => s.single("load-stats"))).toMatch(/^SUCCESS/);
  });

  it("times out when the server never greets", async () => {
    const fake = fakeMgmt({ banner: null });
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port }, commandTimeoutMs: 100 });
    await expect(client.session((s) => s.single("load-stats"))).rejects.toThrow(/Timed out/);
  });

  it("reports unreachable servers", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    await new Promise((r) => fake.server.close(r));
    servers.splice(servers.indexOf(fake.server), 1);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    await expect(client.session((s) => s.single("load-stats"))).rejects.toThrow(/Cannot reach/);
  });

  it("refuses password-protected interfaces", async () => {
    const fake = fakeMgmt({ banner: "ENTER PASSWORD:" });
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port }, commandTimeoutMs: 500 });
    await expect(client.session((s) => s.single("load-stats"))).rejects.toThrow(/password/);
  });

  it("refuses commands that could inject a second command", async () => {
    const fake = fakeMgmt();
    const port = await listenTcp(fake);
    const client = new MgmtClient({ address: { kind: "tcp", host: "127.0.0.1", port } });
    await expect(client.session((s) => s.single("kill x\nsignal SIGTERM"))).rejects.toThrow(/unsafe/);
    expect(fake.commands).not.toContain("signal SIGTERM");
  });
});
