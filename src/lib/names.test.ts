import { describe, expect, it } from "vitest";
import { isServerCn, parseClientName } from "./names";

describe("parseClientName", () => {
  it.each(["alice", "bob-laptop", "ci_runner_01", "A".repeat(32)])("accepts %s", (name) => {
    expect(parseClientName(name)).toBe(name);
  });

  it.each(["", "a b", "../etc", "x;rm -rf", "name\nkill", "A".repeat(33), "ünï", "server_abc"])(
    "rejects %j",
    (name) => {
      expect(parseClientName(name)).toBeNull();
    },
  );

  it("rejects non-strings", () => {
    expect(parseClientName(42)).toBeNull();
    expect(parseClientName(undefined)).toBeNull();
  });
});

describe("isServerCn", () => {
  it("detects the server certificate prefix", () => {
    expect(isServerCn("server_Ab12")).toBe(true);
    expect(isServerCn("myserver_1")).toBe(false);
  });
});
