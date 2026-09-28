import { describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit";
import { auditFilterQuery, auditToCsv, csvField, filterAudit, parseAuditFilter } from "./audit-view";

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    ts: "2026-09-29T10:00:00.000Z",
    actor: "admin",
    action: "add",
    target: null,
    ip: "10.8.0.9",
    ok: true,
    ...overrides,
  };
}

const entries: AuditEntry[] = [
  entry({ ts: "2026-09-29T12:00:00.000Z", action: "revoke", target: "alice-laptop" }),
  entry({ ts: "2026-09-28T23:59:59.999Z", action: "login_failed", actor: "root", ip: "198.51.100.4", ok: false }),
  entry({ ts: "2026-09-28T08:00:00.000Z", action: "add", target: "bob-phone", ok: false, detail: "helper timed out" }),
  entry({ ts: "2026-09-27T08:00:00.000Z", action: "login" }),
];

describe("parseAuditFilter", () => {
  it("returns an empty filter for no params", () => {
    expect(parseAuditFilter({})).toEqual({ action: null, result: null, q: "", from: null, to: null });
  });

  it("parses valid values from a record or URLSearchParams", () => {
    const expected = { action: "revoke", result: "failed", q: "alice", from: "2026-09-01", to: "2026-09-30" };
    const raw = { action: "revoke", result: "failed", q: " alice ", from: "2026-09-01", to: "2026-09-30" };
    expect(parseAuditFilter(raw)).toEqual(expected);
    expect(parseAuditFilter(new URLSearchParams(raw))).toEqual(expected);
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseAuditFilter({ action: "rm -rf", result: "maybe", from: "yesterday", to: "2026-13-45", q: ["a", "b"] }),
    ).toEqual({ action: null, result: null, q: "a", from: null, to: null });
  });

  it("caps the search length", () => {
    expect(parseAuditFilter({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("filterAudit", () => {
  const run = (raw: Record<string, string>) => filterAudit(entries, parseAuditFilter(raw)).map((e) => e.ts.slice(0, 13));

  it("keeps everything with no filter", () => {
    expect(run({})).toHaveLength(4);
  });

  it("filters by action and result", () => {
    expect(run({ action: "add" })).toEqual(["2026-09-28T08"]);
    expect(run({ result: "failed" })).toEqual(["2026-09-28T23", "2026-09-28T08"]);
    expect(run({ result: "ok" })).toEqual(["2026-09-29T12", "2026-09-27T08"]);
  });

  it("filters by inclusive UTC date range", () => {
    expect(run({ from: "2026-09-28", to: "2026-09-28" })).toEqual(["2026-09-28T23", "2026-09-28T08"]);
    expect(run({ from: "2026-09-29" })).toEqual(["2026-09-29T12"]);
    expect(run({ to: "2026-09-27" })).toEqual(["2026-09-27T08"]);
  });

  it("searches actor, target, ip and detail case-insensitively", () => {
    expect(run({ q: "ALICE" })).toEqual(["2026-09-29T12"]);
    expect(run({ q: "root" })).toEqual(["2026-09-28T23"]);
    expect(run({ q: "198.51" })).toEqual(["2026-09-28T23"]);
    expect(run({ q: "timed out" })).toEqual(["2026-09-28T08"]);
  });
});

describe("auditFilterQuery", () => {
  it("serializes only the set fields", () => {
    expect(auditFilterQuery(parseAuditFilter({}))).toBe("");
    expect(auditFilterQuery(parseAuditFilter({ action: "add", q: "a b", to: "2026-09-30" }))).toBe(
      "?action=add&q=a+b&to=2026-09-30",
    );
  });
});

describe("csvField", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line\nbreak", '"line\nbreak"'],
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+1", "'+1"],
    ["-cmd", "'-cmd"],
    ["@x", "'@x"],
    ["\tx", "'\tx"],
    ["=a,b", `"'=a,b"`],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });
});

describe("auditToCsv", () => {
  it("writes a header and one CRLF-terminated row per entry", () => {
    const csv = auditToCsv([entries[0], entries[2]]);
    expect(csv.split("\r\n")).toEqual([
      "timestamp,actor,action,target,ip,result,detail",
      "2026-09-29T12:00:00.000Z,admin,revoke,alice-laptop,10.8.0.9,ok,",
      "2026-09-28T08:00:00.000Z,admin,add,bob-phone,10.8.0.9,failed,helper timed out",
      "",
    ]);
  });

  it("writes empty fields for nulls", () => {
    expect(auditToCsv([entry({ target: null, ip: null })]).split("\r\n")[1]).toBe(
      "2026-09-29T10:00:00.000Z,admin,add,,,ok,",
    );
  });
});
