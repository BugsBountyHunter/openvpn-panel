/**
 * Single-value promise cache: concurrent callers share one load, results live
 * for ttlMs, and failures are never kept.
 */
export class TtlCache<T> {
  private entry: { at: number; value: Promise<T> } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(load: () => Promise<T>): Promise<T> {
    const now = this.now();
    if (this.entry && now - this.entry.at < this.ttlMs) return this.entry.value;
    const entry = { at: now, value: load() };
    this.entry = entry;
    entry.value.catch(() => {
      // Only forget our own failure, not a newer entry stored after clear().
      if (this.entry === entry) this.entry = null;
    });
    return entry.value;
  }

  clear(): void {
    this.entry = null;
  }
}
