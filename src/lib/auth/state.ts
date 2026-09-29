import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { SessionPayload } from "./session";

/**
 * Small persistent auth state, kept next to the audit log (the only writable
 * place in the systemd sandbox):
 *  - a password set from the panel, which overrides ADMIN_PASSWORD_HASH only
 *    while that env value is still the one it replaced (so resetting the
 *    password with the installer always wins);
 *  - a session epoch. Tokens carry the epoch plus a fingerprint of the active
 *    password hash, and only the current pair is accepted, so starting a new
 *    epoch or changing the password (in the panel, with the installer, or by
 *    editing the env) signs out every existing session at once.
 *
 * Read synchronously by the proxy on every request, so reads are cached by
 * file identity (inode, mtime, ctime, size); writes replace the file
 * atomically and go through a per-file lock.
 */

export interface AuthState {
  passwordHash: string | null;
  /** ADMIN_PASSWORD_HASH at the time passwordHash was set. */
  baseHash: string | null;
  /** Current session epoch; "" until the first password change or sign-out. */
  sessionEpoch: string;
}

export const EMPTY_AUTH_STATE: AuthState = { passwordHash: null, baseHash: null, sessionEpoch: "" };

const fileSchema = z.object({
  version: z.literal(1),
  passwordHash: z.string().min(1).max(512).nullable(),
  baseHash: z.string().min(1).max(512).nullable(),
  sessionEpoch: z.string().regex(/^[0-9a-f]{0,64}$/),
});

export function authStatePath(auditLogPath: string): string {
  return join(dirname(auditLogPath), "auth.json");
}

/** Thrown instead of overwriting a damaged file (which would drop a panel-set password). */
export class AuthStateCorruptError extends Error {
  constructor(readonly path: string) {
    super(`${path} is damaged`);
    this.name = "AuthStateCorruptError";
  }
}

interface ReadResult {
  state: AuthState;
  corrupt: boolean;
}

const cache = new Map<string, { key: string; result: ReadResult }>();

function parse(text: string): AuthState | null {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const { passwordHash, baseHash, sessionEpoch } = parsed.data;
    return { passwordHash, baseHash, sessionEpoch };
  } catch {
    return null;
  }
}

function corruptEpoch(text: string): string {
  return `corrupt:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function readWithStatus(path: string): ReadResult {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: EMPTY_AUTH_STATE, corrupt: false };
    throw error;
  }
  const key = `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  const hit = cache.get(path);
  if (hit?.key === key) return hit.result;

  const text = readFileSync(path, "utf8");
  const parsed = parse(text);
  // Fail safe: never trust a damaged override, and reject every existing
  // session (rather than reviving revoked ones). The epoch is derived from the
  // content so it stays stable and sign-ins after the damage keep working.
  const result: ReadResult = parsed
    ? { state: parsed, corrupt: false }
    : { state: { ...EMPTY_AUTH_STATE, sessionEpoch: corruptEpoch(text) }, corrupt: true };
  if (!parsed) console.error(`[openvpn-panel] ${path} is unreadable; ignoring the stored password and older sessions`);
  cache.set(path, { key, result });
  return result;
}

export function readAuthState(path: string): AuthState {
  return readWithStatus(path).state;
}

export function newSessionEpoch(): string {
  return randomBytes(8).toString("hex");
}

export async function writeAuthState(path: string, state: AuthState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const body = `${JSON.stringify({ version: 1, ...state })}\n`;
  try {
    await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
    cache.delete(path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Read-modify-write under a per-file lock, so concurrent changes (e.g. a
 * password change and "sign out other sessions") never undo each other.
 * Refuses to touch a damaged file. Do slow work (hashing) before calling.
 */
export async function updateAuthState(
  path: string,
  update: (current: AuthState) => AuthState | Promise<AuthState>,
): Promise<AuthState> {
  const previous = locks.get(path) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const { state, corrupt } = readWithStatus(path);
      if (corrupt) throw new AuthStateCorruptError(path);
      const next = await update(state);
      await writeAuthState(path, next);
      return next;
    });
  locks.set(path, run);
  try {
    return await run;
  } finally {
    if (locks.get(path) === run) locks.delete(path);
  }
}

export function effectivePasswordHash(envHash: string | null, state: AuthState): string | null {
  return state.passwordHash && state.baseHash === envHash ? state.passwordHash : envHash;
}

/**
 * The value a current token must carry: epoch plus a short fingerprint of the
 * active password hash (a digest, never the hash itself).
 */
export function sessionEpochFor(envHash: string | null, state: AuthState): string {
  const active = effectivePasswordHash(envHash, state) ?? "demo";
  const fingerprint = createHash("sha256").update(active).digest("hex").slice(0, 16);
  return `${state.sessionEpoch || "0"}.${fingerprint}`;
}

export function isSessionCurrent(session: SessionPayload, envHash: string | null, state: AuthState): boolean {
  return session.sep === sessionEpochFor(envHash, state);
}
