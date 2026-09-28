import "server-only";
import { getBackend } from "./backend";
import { PanelService } from "./service";
import type { ServerStatus, VpnClient } from "./types";

export function getPanel(): PanelService {
  return new PanelService(getBackend());
}

export interface Snapshot {
  status: ServerStatus;
  clients: VpnClient[];
  /** Time the snapshot was taken (epoch ms), for consistent relative times. */
  now: number;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const panel = getPanel();
  const [status, clients] = await Promise.all([panel.getStatus(), panel.listClients()]);
  return { status, clients, now: Date.now() };
}
