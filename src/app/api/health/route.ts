import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness probe used by deploy checks. Reveals nothing else. */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
