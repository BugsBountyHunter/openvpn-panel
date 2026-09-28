import { execFile, type ExecFileException } from "node:child_process";
import { isValidCertDays } from "./cert-days";
import { isValidPassphrase } from "./client-options";
import { CLIENT_NAME_PATTERN } from "./names";
import type { AddOptions } from "./types";

/**
 * Runs the root-owned helper (server/openvpn-panel-helper) through
 * `sudo -n`, without a shell. The helper re-validates everything; we validate
 * here too so bad input never reaches sudo.
 */

export type HelperVerb = "add" | "revoke" | "renew" | "list" | "status" | "pki";

export interface HelperRunner {
  /** A passphrase (add only) is written to the helper's stdin, never argv. */
  run(verb: HelperVerb, name?: string, options?: AddOptions): Promise<string>;
}

export class HelperError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "HelperError";
  }
}

const NEEDS_NAME: ReadonlySet<HelperVerb> = new Set(["add", "revoke", "renew"]);
const TAKES_CERT_DAYS: ReadonlySet<HelperVerb> = new Set(["add", "renew"]);
const MAX_STDERR = 500;

// Minimal, fixed environment for the privileged call (cast: Next types require NODE_ENV).
const HELPER_ENV = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "C.UTF-8",
} as unknown as NodeJS.ProcessEnv;

/** Helper argv: `add <name> [days|default] [passphrase]`, `renew <name> [days]`. */
function optionArgs(verb: HelperVerb, options: AddOptions): string[] {
  const { certDays, passphrase } = options;
  if (certDays !== undefined) {
    if (!TAKES_CERT_DAYS.has(verb)) throw new HelperError(`"${verb}" takes no certificate lifetime`, null);
    if (!isValidCertDays(certDays)) throw new HelperError("Invalid certificate lifetime", null);
  }
  const days = certDays === undefined ? [] : [String(certDays)];
  if (passphrase === undefined) return days;
  if (verb !== "add") throw new HelperError(`"${verb}" takes no passphrase`, null);
  if (!isValidPassphrase(passphrase)) throw new HelperError("Invalid passphrase", null);
  // Only a marker goes in argv; the passphrase itself is sent on stdin.
  return [days[0] ?? "default", "passphrase"];
}

export function buildHelperArgs(helperPath: string, verb: HelperVerb, name?: string, options: AddOptions = {}): string[] {
  const extra = optionArgs(verb, options);
  if (NEEDS_NAME.has(verb)) {
    if (!name || !CLIENT_NAME_PATTERN.test(name)) throw new HelperError("Invalid client name", null);
    return ["-n", "--", helperPath, verb, name, ...extra];
  }
  if (name !== undefined) throw new HelperError(`"${verb}" takes no name`, null);
  return ["-n", "--", helperPath, verb];
}

function summarizeStderr(stderr: string): string {
  const cleaned = stderr
    .replace(/\u001b\[[0-9;]*m/g, "") // ANSI colours
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  const lastLines = cleaned.split("\n").slice(-3).join(" | ");
  return lastLines.slice(-MAX_STDERR);
}

export class SudoHelperRunner implements HelperRunner {
  constructor(
    private readonly helperPath: string,
    private readonly timeoutMs: number = 120_000,
    private readonly sudoPath: string = "sudo",
  ) {}

  run(verb: HelperVerb, name?: string, options?: AddOptions): Promise<string> {
    const args = buildHelperArgs(this.helperPath, verb, name, options);
    const input = options?.passphrase === undefined ? "" : `${options.passphrase}\n`;
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.sudoPath,
        args,
        {
          timeout: this.timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          env: HELPER_ENV,
        },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          // Never include stdout in errors: for "add"/"renew" it may hold a private key.
          const code = typeof error.code === "number" ? error.code : null;
          const reason = error.killed ? "timed out" : summarizeStderr(stderr) || error.message;
          reject(new HelperError(`Helper "${verb}" failed: ${reason}`, code));
        },
      );
      // Always close stdin so the helper never waits on it; ignore EPIPE if it exited early.
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    });
  }
}
