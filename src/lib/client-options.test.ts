import { describe, expect, it } from "vitest";
import { passphraseSchema } from "./client-options";

describe("passphraseSchema", () => {
  it.each(["correct horse", "p4ss-wörd!", "x".repeat(128)])("accepts %j", (value) => {
    expect(passphraseSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["too short", "short"],
    ["too long", "x".repeat(129)],
    ["newline", "line one\nline two"],
    ["NUL", "abcdefgh\u0000"],
    ["tab", "abc\tdefgh"],
  ])("rejects %s", (_label, value) => {
    expect(passphraseSchema.safeParse(value).success).toBe(false);
  });
});
