import { describe, expect, it } from "vitest";
import { formatAge, formatBytes, formatDuration } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [5 * 1024 ** 3, "5.0 GB"],
    [250 * 1024 ** 2, "250 MB"],
  ])("%d -> %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours and days", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(3 * 3_600_000 + 7 * 60_000)).toBe("3h 7m");
    expect(formatDuration(2 * 86_400_000 + 5 * 3_600_000)).toBe("2d 5h");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "just now"],
    [4_999, "just now"],
    [5_000, "5s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [3 * 3_600_000, "3h ago"],
    [-500, "just now"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});
