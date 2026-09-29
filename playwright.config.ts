import { defineConfig, devices } from "@playwright/test";
import { E2E_AUDIT_LOG, E2E_STATE_DIR } from "./e2e/state";

const PORT = 3199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E tests run against the production standalone build in demo mode.
 * Build first: `npm run build`. Locally the installed Chrome is used;
 * CI installs Playwright's Chromium.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel: process.env.CI ? undefined : "chrome" },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: {
    // Audit log and auth state (panel-set password, revoked sessions) start clean on every run.
    command: `rm -rf "${E2E_STATE_DIR}" && bash scripts/package-release.sh >/dev/null && node release/start.mjs`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PANEL_MODE: "demo",
      PANEL_HOST: "127.0.0.1",
      PANEL_PORT: String(PORT),
      AUDIT_LOG_PATH: E2E_AUDIT_LOG,
    },
  },
});
