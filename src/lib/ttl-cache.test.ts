import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./ttl-cache";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("reuses a value until it expires", async () => {
    const c = clock();
    const cache = new TtlCache<number>(1000, c.now);
    const load = vi.fn(async () => 42);
    expect(await cache.get(load)).toBe(42);
    c.advance(999);
    expect(await cache.get(load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(1);
    await cache.get(load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent callers into one load", async () => {
    const cache = new TtlCache<string>(1000);
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const both = Promise.all([cache.get(load), cache.get(load)]);
    resolve("once");
    expect(await both).toEqual(["once", "once"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep failures", async () => {
    const cache = new TtlCache<number>(1000);
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(7);
    await expect(cache.get(load)).rejects.toThrow("boom");
    expect(await cache.get(load)).toBe(7);
  });

  it("clear forces the next get to load", async () => {
    const cache = new TtlCache<number>(60_000);
    const load = vi.fn(async () => 1);
    await cache.get(load);
    cache.clear();
    await cache.get(load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a load that finishes after clear does not overwrite the newer entry", async () => {
    const cache = new TtlCache<string>(60_000);
    let resolveOld!: (v: string) => void;
    const old = cache.get(() => new Promise<string>((r) => (resolveOld = r)));
    cache.clear();
    expect(await cache.get(async () => "new")).toBe("new");
    resolveOld("old");
    await old;
    expect(await cache.get(async () => "unused")).toBe("new");
  });
});
