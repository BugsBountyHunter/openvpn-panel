import "server-only";
import { getConfig } from "../config";
import { SudoHelperRunner } from "../helper";
import { MgmtClient } from "../mgmt/client";
import type { Backend } from "../types";
import { DemoBackend } from "./demo";
import { LiveBackend } from "./live";

const holder = globalThis as unknown as { __panelBackend?: Backend };

function createBackend(): Backend {
  const config = getConfig();
  switch (config.mode) {
    case "demo":
      return new DemoBackend();
    case "live":
      return new LiveBackend(new MgmtClient({ address: config.mgmt }), new SudoHelperRunner(config.helperPath));
  }
}

/** One backend per process, so the management-interface queue is shared. */
export function getBackend(): Backend {
  if (!holder.__panelBackend) holder.__panelBackend = createBackend();
  return holder.__panelBackend;
}
