import { z } from "zod";
import { fail, failFromError, ok } from "@/lib/http";
import { clientNameSchema } from "@/lib/names";
import { getPanel } from "@/lib/panel";

export const dynamic = "force-dynamic";

const addSchema = z.object({ name: clientNameSchema });

export async function GET() {
  try {
    return ok(await getPanel().listClients());
  } catch (error) {
    return failFromError(error, "Listing clients");
  }
}

/** Creates a client and streams its profile back. The profile is never stored or logged. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  const { name } = parsed.data;
  try {
    const profile = await getPanel().addClient(name);
    return new Response(profile, {
      status: 201,
      headers: {
        "Content-Type": "application/x-openvpn-profile",
        "Content-Disposition": `attachment; filename="${name}.ovpn"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failFromError(error, "Adding client");
  }
}
