import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * Append-only JSON-lines audit log. One object per line; never rewritten.
 * Profiles (.ovpn contents) and passwords are never passed in here.
 */

export const AUDIT_ACTIONS = ["login", "login_failed", "logout", "add", "revoke", "disconnect"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const entrySchema = z.object({
  ts: z.string(),
  actor: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  target: z.string().nullable(),
  ip: z.string().nullable(),
  ok: z.boolean(),
  detail: z.string().optional(),
});

export type AuditEntry = z.infer<typeof entrySchema>;
export type AuditInput = Omit<AuditEntry, "ts">;

const MAX_FIELD = 200;
/** Only the tail of the file is read for display. */
const MAX_READ_BYTES = 1024 * 1024;

function clean(value: string): string {
  // Strip control characters so a crafted username can't forge extra lines.
  return value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, MAX_FIELD);
}

export function serializeEntry(input: AuditInput, now: Date = new Date()): string {
  const entry: AuditEntry = {
    ts: now.toISOString(),
    actor: clean(input.actor),
    action: input.action,
    target: input.target === null ? null : clean(input.target),
    ip: input.ip === null ? null : clean(input.ip),
    ok: input.ok,
    ...(input.detail ? { detail: clean(input.detail) } : {}),
  };
  return `${JSON.stringify(entry)}\n`;
}

export async function appendAudit(path: string, input: AuditInput): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  await appendFile(path, serializeEntry(input), { flag: "a", mode: 0o600 });
}

/** Records an audit entry; failures are logged but never block the action. */
export async function audit(path: string, input: AuditInput): Promise<void> {
  try {
    await appendAudit(path, input);
  } catch (error) {
    console.error("[openvpn-panel] failed to write audit log:", error instanceof Error ? error.message : error);
  }
}

export function parseAuditLines(text: string): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = entrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Skip corrupt or partial lines (e.g. the first line of a tail read).
    }
  }
  return entries;
}

/** Most recent entries first. */
export async function readAudit(path: string, limit = 500): Promise<AuditEntry[]> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const start = Math.max(0, size - MAX_READ_BYTES);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return parseAuditLines(buffer.toString("utf8")).reverse().slice(0, limit);
  } finally {
    await handle.close();
  }
}
