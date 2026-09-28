import "server-only";
import { getConfig } from "../config";
import type { Backend } from "../types";
import { DemoBackend } from "./demo";

const holder = globalThis as unknown as { __panelBackend?: Backend };

function createBackend(): Backend {
  const config = getConfig();
  switch (config.mode) {
    case "demo":
      return new DemoBackend();
    case "live":
      throw new Error("Live backend is not available yet");
  }
}

export function getBackend(): Backend {
  if (!holder.__panelBackend) holder.__panelBackend = createBackend();
  return holder.__panelBackend;
}
