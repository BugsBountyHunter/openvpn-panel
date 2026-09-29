import { z } from "zod";

/** Certificate lifetime limits. Must match the checks in server/openvpn-panel-helper. */
export const CERT_DAYS_MIN = 1;
export const CERT_DAYS_MAX = 7300;
/** openvpn-install's own default. */
export const CERT_DAYS_DEFAULT = 3650;

export function isValidCertDays(days: number): boolean {
  return Number.isInteger(days) && days >= CERT_DAYS_MIN && days <= CERT_DAYS_MAX;
}

export const certDaysSchema = z
  .number()
  .int("Validity must be a whole number of days")
  .min(CERT_DAYS_MIN, `Validity must be ${CERT_DAYS_MIN}-${CERT_DAYS_MAX} days`)
  .max(CERT_DAYS_MAX, `Validity must be ${CERT_DAYS_MIN}-${CERT_DAYS_MAX} days`);
