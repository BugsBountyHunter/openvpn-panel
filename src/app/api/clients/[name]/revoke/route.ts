import { fail, failFromError, ok } from "@/lib/http";
import { parseClientName } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: RouteContext<"/api/clients/[name]/revoke">) {
  const name = parseClientName((await ctx.params).name);
  if (!name) return fail("Invalid client name", 400);
  try {
    await getPanel().revokeClient(name);
    return ok({ name, revoked: true });
  } catch (error) {
    return failFromError(error, "Revoking client");
  }
}
