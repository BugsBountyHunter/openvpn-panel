import { resolve } from "node:path";

/**
 * Where the e2e server keeps its audit log and auth state. Absolute, because
 * the server runs from release/; wiped on every server start.
 */
export const E2E_STATE_DIR = resolve(__dirname, "../.e2e-state");
export const E2E_AUDIT_LOG = resolve(E2E_STATE_DIR, "audit.log");
/** Derived by the panel from the audit log location (src/lib/auth/state.ts). */
export const E2E_AUTH_STATE = resolve(E2E_STATE_DIR, "auth.json");
