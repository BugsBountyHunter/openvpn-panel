import { withAuth } from "@/lib/auth/guard";
import { failFromError, ok } from "@/lib/http";
import { loadSnapshot } from "@/lib/panel";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  try {
    return ok(await loadSnapshot());
  } catch (error) {
    return failFromError(error, "Reading status");
  }
});
