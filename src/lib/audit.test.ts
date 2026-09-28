import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAudit, parseAuditLines, readAudit, serializeEntry } from "./audit";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "panel-audit-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("audit log", () => {
  it("appends JSON lines and reads newest first", async () => {
    const path = join(dir, "nested", "audit.log");
    await appendAudit(path, { actor: "admin", action: "add", target: "alice", ip: "10.8.0.2", ok: true });
    await appendAudit(path, { actor: "admin", action: "revoke", target: "alice", ip: "10.8.0.2", ok: true });
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    const entries = await readAudit(path);
    expect(entries.map((e) => e.action)).toEqual(["revoke", "add"]);
  });

  it("returns an empty list when the file does not exist", async () => {
    expect(await readAudit(join(dir, "missing.log"))).toEqual([]);
  });

  it("neutralises control characters so entries cannot be forged", () => {
    const line = serializeEntry({ actor: 'x"}\n{"action":"add"', action: "login_failed", target: null, ip: null, ok: false });
    expect(line.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(line).actor).toContain("?");
  });

  it("skips corrupt lines", async () => {
    const path = join(dir, "audit.log");
    const good = serializeEntry({ actor: "admin", action: "login", target: null, ip: null, ok: true });
    await writeFile(path, `garbage\n${good}{"partial":`);
    expect(await readAudit(path)).toHaveLength(1);
    expect(parseAuditLines('{"ts":"x","actor":"a","action":"nope","target":null,"ip":null,"ok":true}')).toEqual([]);
  });
});
