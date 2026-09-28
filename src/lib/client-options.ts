import { z } from "zod";

/**
 * Passphrase for a client's private key. It travels browser -> API -> helper
 * stdin -> installer env and is never logged, stored or put in argv.
 * Control characters are refused because the helper reads one line.
 */
export const PASSPHRASE_MIN = 8;
export const PASSPHRASE_MAX = 128;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isValidPassphrase(value: string): boolean {
  return value.length >= PASSPHRASE_MIN && value.length <= PASSPHRASE_MAX && !CONTROL_CHARS.test(value);
}

export const passphraseSchema = z
  .string()
  .refine(isValidPassphrase, `Passphrase must be ${PASSPHRASE_MIN}-${PASSPHRASE_MAX} characters, without control characters`);
