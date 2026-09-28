import { NextResponse } from "next/server";
import { PanelError } from "./service";

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status, headers: NO_STORE });
}

export function fail(error: string, status: number): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ success: false, data: null, error }, { status, headers: NO_STORE });
}

/**
 * Maps thrown errors to responses. PanelError messages are shown verbatim;
 * anything else is logged server-side and returned as a generic message.
 */
export function failFromError(error: unknown, context: string): NextResponse<ApiResponse<never>> {
  if (error instanceof PanelError) return fail(error.message, error.status);
  console.error(`[openvpn-panel] ${context} failed:`, error instanceof Error ? error.message : error);
  return fail(`${context} failed. Check the panel logs for details.`, 502);
}
