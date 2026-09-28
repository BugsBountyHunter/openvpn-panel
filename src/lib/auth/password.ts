import bcrypt from "bcryptjs";
import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from "node:crypto";

/**
 * Password hashing. Accepts two formats in ADMIN_PASSWORD_HASH:
 *  - argon2id PHC strings: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
 *  - bcrypt: $2a$ / $2b$ / $2y$
 */

const ARGON2_DEFAULTS = { memory: 65_536, passes: 3, parallelism: 4, tagLength: 32 } as const;
const MAX_PASSWORD_LENGTH = 1024;

function argon2Async(params: Argon2Parameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", params, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const b64 = (buf: Buffer): string => buf.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { memory, passes, parallelism, tagLength } = ARGON2_DEFAULTS;
  const key = await argon2Async({ message: password, nonce: salt, memory, passes, parallelism, tagLength });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(key)}`;
}

interface ParsedArgon2 {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function parseArgon2(encoded: string): ParsedArgon2 | null {
  const match = PHC_PATTERN.exec(encoded);
  if (!match) return null;
  const [memory, passes, parallelism] = [match[1], match[2], match[3]].map(Number);
  // Refuse absurd parameters from a misconfigured env to avoid resource exhaustion.
  if (memory < 8 * parallelism || memory > 1_048_576 || passes < 1 || passes > 20 || parallelism < 1 || parallelism > 16) {
    return null;
  }
  const salt = Buffer.from(match[4], "base64");
  const hash = Buffer.from(match[5], "base64");
  if (salt.length < 8 || hash.length < 16) return null;
  return { memory, passes, parallelism, salt, hash };
}

export function isSupportedHash(encoded: string): boolean {
  return parseArgon2(encoded) !== null || /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(encoded);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const argon = parseArgon2(encoded);
  if (argon) {
    const key = await argon2Async({
      message: password,
      nonce: argon.salt,
      memory: argon.memory,
      passes: argon.passes,
      parallelism: argon.parallelism,
      tagLength: argon.hash.length,
    });
    return timingSafeEqual(key, argon.hash);
  }
  if (/^\$2[aby]\$/.test(encoded)) {
    // bcryptjs understands $2a$/$2b$; $2y$ (htpasswd) is the same algorithm.
    return bcrypt.compare(password, encoded.replace(/^\$2y\$/, "$2b$"));
  }
  return false;
}
