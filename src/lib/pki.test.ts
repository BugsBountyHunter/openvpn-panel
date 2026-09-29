import { describe, expect, it } from "vitest";
import { pkiWarnings } from "./pki";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 29, 12);

describe("pkiWarnings", () => {
  it("returns nothing when everything is far from expiry or unknown", () => {
    expect(pkiWarnings({ serverCertExpiresAt: now + 400 * DAY, caCertExpiresAt: null, crlNextUpdate: now + 31 * DAY }, now)).toEqual([]);
  });

  it("warns within 30 days and escalates within 7 days or once expired, soonest first", () => {
    const warnings = pkiWarnings(
      { serverCertExpiresAt: now + 20 * DAY, caCertExpiresAt: now - 2 * DAY, crlNextUpdate: now + 5 * DAY + 1000 },
      now,
    );
    expect(warnings.map((w) => [w.item, w.daysLeft, w.severity])).toEqual([
      ["ca", -2, "danger"],
      ["crl", 5, "danger"],
      ["server", 20, "warn"],
    ]);
  });

  it("treats exactly 30 days as a warning and 31 as fine", () => {
    expect(pkiWarnings({ serverCertExpiresAt: now + 30 * DAY, caCertExpiresAt: null, crlNextUpdate: null }, now)).toHaveLength(1);
    expect(pkiWarnings({ serverCertExpiresAt: now + 31 * DAY, caCertExpiresAt: null, crlNextUpdate: null }, now)).toHaveLength(0);
  });

  it("counts a partial day as not yet expired", () => {
    const [warning] = pkiWarnings({ serverCertExpiresAt: now + DAY / 2, caCertExpiresAt: null, crlNextUpdate: null }, now);
    expect(warning.daysLeft).toBe(0);
    expect(warning.expired).toBe(false);
  });
});
