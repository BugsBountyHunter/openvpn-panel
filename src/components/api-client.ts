import type { AddOptions } from "@/lib/types";

/** Browser-side helpers for calling the panel API. */

interface ApiEnvelope {
  success: boolean;
  error: string | null;
}

/** Thrown when the session expired; callers should send the user to /login. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Your session expired. Please sign in again.");
    this.name = "UnauthorizedError";
  }
}

async function ensureOk(response: Response): Promise<Response> {
  if (response.status === 401) throw new UnauthorizedError();
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as ApiEnvelope | null;
  throw new Error(body?.error ?? `Request failed (${response.status})`);
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  return ensureOk(response);
}

export async function apiPost(url: string, body?: unknown): Promise<void> {
  await postJson(url, body);
}

/** Hands a profile response straight to the browser as a download; it is never stored. */
async function download(response: Response, filename: string): Promise<void> {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Creates a client and downloads its profile. */
export async function addClientAndDownload(name: string, options: AddOptions = {}): Promise<void> {
  await download(await postJson("/api/clients", { name, ...options }), `${name}.ovpn`);
}

/** Renews a client certificate and downloads the new profile. */
export async function renewClientAndDownload(name: string, certDays?: number): Promise<void> {
  const response = await postJson(`/api/clients/${encodeURIComponent(name)}/renew`, { certDays });
  await download(response, `${name}.ovpn`);
}
