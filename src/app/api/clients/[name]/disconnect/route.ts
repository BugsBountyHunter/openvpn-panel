import { fail, failFromError, ok } from "@/lib/http";
import { parseClientName } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: RouteContext<"/api/clients/[name]/disconnect">) {
  const name = parseClientName((await ctx.params).name);
  if (!name) return fail("Invalid client name", 400);
  try {
    const disconnected = await getPanel().disconnectClient(name);
    return ok({ name, disconnected });
  } catch (error) {
    return failFromError(error, "Disconnecting client");
  }
}
