import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHelperArgs, HelperError, SudoHelperRunner } from "./helper";

describe("buildHelperArgs", () => {
  it("builds argv for sudo without a shell", () => {
    expect(buildHelperArgs("/usr/local/sbin/h", "add", "alice")).toEqual(["-n", "--", "/usr/local/sbin/h", "add", "alice"]);
    expect(buildHelperArgs("/usr/local/sbin/h", "list")).toEqual(["-n", "--", "/usr/local/sbin/h", "list"]);
    expect(buildHelperArgs("/usr/local/sbin/h", "pki")).toEqual(["-n", "--", "/usr/local/sbin/h", "pki"]);
  });

  it("rejects bad or missing names", () => {
    expect(() => buildHelperArgs("/h", "add")).toThrow(HelperError);
    expect(() => buildHelperArgs("/h", "revoke", "$(reboot)")).toThrow(HelperError);
    expect(() => buildHelperArgs("/h", "list", "extra")).toThrow(HelperError);
    expect(() => buildHelperArgs("/h", "pki", "extra")).toThrow(HelperError);
  });
});

describe("SudoHelperRunner", () => {
  let dir: string;
  let fakeSudo: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "helper-"));
    fakeSudo = join(dir, "sudo");
    // Stand-in for sudo: echoes argv one per line, or fails on "revoke".
    writeFileSync(
      fakeSudo,
      '#!/bin/sh\nif [ "$4" = revoke ]; then echo "\\033[31mError: no such client\\033[0m" >&2; echo SECRET-STDOUT; exit 3; fi\nprintf \'%s\\n\' "$@"\n',
    );
    chmodSync(fakeSudo, 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("passes arguments verbatim", async () => {
    const runner = new SudoHelperRunner("/usr/local/sbin/openvpn-panel-helper", 5000, fakeSudo);
    const out = await runner.run("add", "alice");
    expect(out.trim().split("\n")).toEqual(["-n", "--", "/usr/local/sbin/openvpn-panel-helper", "add", "alice"]);
  });

  it("reports stderr but never stdout on failure", async () => {
    const runner = new SudoHelperRunner("/h", 5000, fakeSudo);
    const error = await runner.run("revoke", "alice").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HelperError);
    expect((error as HelperError).exitCode).toBe(3);
    expect((error as HelperError).message).toContain("no such client");
    expect((error as HelperError).message).not.toContain("SECRET-STDOUT");
    expect((error as HelperError).message).not.toContain("\u001b");
  });
});
