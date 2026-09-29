import type { PkiStatus } from "./types";

/** Turns PKI dates into warnings for the overview. Pure. */

const DAY_MS = 86_400_000;
export const PKI_WARNING_DAYS = 30;
export const PKI_DANGER_DAYS = 7;

export type PkiItem = "server" | "ca" | "crl";

export interface PkiWarning {
  item: PkiItem;
  expiresAt: number;
  /** Whole days left, rounded down; negative once expired. */
  daysLeft: number;
  expired: boolean;
  severity: "warn" | "danger";
}

const FIELDS: ReadonlyArray<[PkiItem, keyof PkiStatus]> = [
  ["server", "serverCertExpiresAt"],
  ["ca", "caCertExpiresAt"],
  ["crl", "crlNextUpdate"],
];

export function pkiWarnings(pki: PkiStatus, now: number): PkiWarning[] {
  return FIELDS.flatMap(([item, field]): PkiWarning[] => {
    const expiresAt = pki[field];
    if (expiresAt === null) return [];
    const daysLeft = Math.floor((expiresAt - now) / DAY_MS);
    if (daysLeft > PKI_WARNING_DAYS) return [];
    const expired = expiresAt <= now;
    return [{ item, expiresAt, daysLeft, expired, severity: expired || daysLeft <= PKI_DANGER_DAYS ? "danger" : "warn" }];
  }).toSorted((a, b) => a.expiresAt - b.expiresAt);
}
