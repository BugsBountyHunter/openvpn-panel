import { z } from "zod";

/** Must match the regex enforced by server/openvpn-panel-helper. */
export const CLIENT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** The server's own certificate uses this CN prefix and must never be touched. */
export const SERVER_CN_PREFIX = "server_";

export function isServerCn(name: string): boolean {
  return name.startsWith(SERVER_CN_PREFIX);
}

export const clientNameSchema = z
  .string()
  .trim()
  .regex(CLIENT_NAME_PATTERN, "Use 1-32 letters, digits, '-' or '_'")
  .refine((name) => !isServerCn(name), {
    message: `Names starting with "${SERVER_CN_PREFIX}" are reserved`,
  });

export function parseClientName(input: unknown): string | null {
  const result = clientNameSchema.safeParse(input);
  return result.success ? result.data : null;
}
