import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authStatePath } from "./auth/state";
import { parseMgmtAddress, type MgmtAddress } from "./mgmt/address";

const MIN_SECRET_LENGTH = 32;

/** Password accepted in demo mode when ADMIN_PASSWORD_HASH is not set. */
export const DEMO_PASSWORD = "demo";

const envSchema = z
  .object({
    PANEL_MODE: z.enum(["demo", "live"]).default("demo"),
    PANEL_HOST: z.string().min(1).default("127.0.0.1"),
    PANEL_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
    OVPN_MGMT: z.string().default("tcp:127.0.0.1:7505"),
    PANEL_HELPER: z
      .string()
      .startsWith("/", "PANEL_HELPER must be an absolute path")
      .default("/usr/local/sbin/openvpn-panel-helper"),
    ADMIN_USER: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, "ADMIN_USER has invalid characters")
      .default("admin"),
    ADMIN_PASSWORD_HASH: z.string().min(1).optional(),
    SESSION_SECRET: z.string().optional(),
    AUDIT_LOG_PATH: z.string().min(1).default("./data/audit.log"),
  })
  .superRefine((env, ctx) => {
    try {
      parseMgmtAddress(env.OVPN_MGMT);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["OVPN_MGMT"],
        message: (error as Error).message,
      });
    }
    if (env.ADMIN_PASSWORD_HASH && !/^\$(argon2id\$|2[aby]\$)/.test(env.ADMIN_PASSWORD_HASH)) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_PASSWORD_HASH"],
        message: 'must be an argon2id or bcrypt hash (npm run hash-password); in .env files escape "$" as "\\$"',
      });
    }
    if (env.PANEL_MODE !== "live") return;
    if (!env.ADMIN_PASSWORD_HASH) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_PASSWORD_HASH"],
        message: "required when PANEL_MODE=live",
      });
    }
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SECRET_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: `must be at least ${MIN_SECRET_LENGTH} characters when PANEL_MODE=live`,
      });
    }
  });

export interface PanelConfig {
  mode: "demo" | "live";
  host: string;
  port: number;
  mgmt: MgmtAddress;
  helperPath: string;
  adminUser: string;
  /** null only in demo mode, where DEMO_PASSWORD is accepted instead. */
  adminPasswordHash: string | null;
  sessionSecret: string;
  auditLogPath: string;
  /** Password set from the panel and session revocation; next to the audit log. */
  authStatePath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): PanelConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid panel configuration: ${details}`);
  }
  const e = parsed.data;
  const secret =
    e.SESSION_SECRET && e.SESSION_SECRET.length >= MIN_SECRET_LENGTH
      ? e.SESSION_SECRET
      : randomBytes(32).toString("hex"); // demo only: sessions reset on restart
  return {
    mode: e.PANEL_MODE,
    host: e.PANEL_HOST,
    port: e.PANEL_PORT,
    mgmt: parseMgmtAddress(e.OVPN_MGMT),
    helperPath: e.PANEL_HELPER,
    adminUser: e.ADMIN_USER,
    adminPasswordHash: e.ADMIN_PASSWORD_HASH ?? null,
    sessionSecret: secret,
    auditLogPath: e.AUDIT_LOG_PATH,
    authStatePath: authStatePath(e.AUDIT_LOG_PATH),
  };
}

const globalForConfig = globalThis as unknown as { __panelConfig?: PanelConfig };

/** Lazily validated config; throws a descriptive error on bad env. */
export function getConfig(): PanelConfig {
  if (!globalForConfig.__panelConfig) {
    globalForConfig.__panelConfig = loadConfig(process.env);
  }
  return globalForConfig.__panelConfig;
}
