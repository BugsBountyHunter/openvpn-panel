import type { NextResponse } from "next/server";
import { fail, failFromError, type ApiResponse } from "../http";
import { AuthStateCorruptError } from "./state";

/** Maps auth-state write failures to responses; a damaged file gets recovery steps. */
export function authStateFailure(error: unknown, context: string): NextResponse<ApiResponse<never>> {
  if (error instanceof AuthStateCorruptError) {
    console.error(`[openvpn-panel] ${context} refused: ${error.message}`);
    return fail(
      "The panel's auth state file is damaged, so nothing was changed. On the server, run " +
        "`sudo bash install.sh --reset-password`, then sign in again.",
      500,
    );
  }
  return failFromError(error, context);
}
