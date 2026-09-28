import { isServerCn } from "./names";
import type { Backend, CertOptions, PkiStatus, ServerStatus, VpnClient } from "./types";

/** Error whose message is safe to show to the (authenticated) admin. */
export class PanelError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "PanelError";
  }
}

const statusOrder: Record<VpnClient["status"], number> = { active: 0, revoked: 1 };

function compareClients(a: VpnClient, b: VpnClient): number {
  if (a.online !== b.online) return a.online ? -1 : 1;
  if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
  return a.name.localeCompare(b.name);
}

function assertNotServer(name: string): void {
  if (isServerCn(name)) {
    throw new PanelError("The server certificate cannot be modified", 403);
  }
}

/**
 * Policy layer on top of any Backend: hides the server's own certificate,
 * refuses to act on it, and sorts results for display.
 */
export class PanelService {
  constructor(private readonly backend: Backend) {}

  get mode(): string {
    return this.backend.kind;
  }

  getStatus(): Promise<ServerStatus> {
    return this.backend.getStatus();
  }

  async listClients(): Promise<VpnClient[]> {
    const clients = await this.backend.listClients();
    return clients.filter((c) => !isServerCn(c.name)).toSorted(compareClients);
  }

  async addClient(name: string): Promise<string> {
    assertNotServer(name);
    const existing = await this.backend.listClients();
    if (existing.some((c) => c.name === name)) {
      throw new PanelError(`A client named "${name}" already exists`, 409);
    }
    return this.backend.addClient(name);
  }

  async revokeClient(name: string): Promise<void> {
    await this.findActive(name, "is already revoked");
    await this.backend.revokeClient(name);
  }

  async renewClient(name: string, options?: CertOptions): Promise<string> {
    await this.findActive(name, "is revoked and cannot be renewed");
    return this.backend.renewClient(name, options);
  }

  private async findActive(name: string, revokedMessage: string): Promise<VpnClient> {
    assertNotServer(name);
    const existing = await this.backend.listClients();
    const target = existing.find((c) => c.name === name);
    if (!target) throw new PanelError(`Client "${name}" not found`, 404);
    if (target.status === "revoked") throw new PanelError(`Client "${name}" ${revokedMessage}`, 409);
    return target;
  }

  async disconnectClient(name: string): Promise<boolean> {
    assertNotServer(name);
    return this.backend.disconnectClient(name);
  }

  getPki(): Promise<PkiStatus> {
    return this.backend.getPki();
  }
}
