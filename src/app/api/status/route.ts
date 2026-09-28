import { failFromError, ok } from "@/lib/http";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const panel = getPanel();
    const [status, clients] = await Promise.all([panel.getStatus(), panel.listClients()]);
    return ok({ status, clients });
  } catch (error) {
    return failFromError(error, "Reading status");
  }
}
