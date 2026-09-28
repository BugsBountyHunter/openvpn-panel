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

/** Creates a client and hands the profile straight to the browser as a download. */
export async function addClientAndDownload(name: string): Promise<void> {
  const response = await postJson("/api/clients", { name });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.ovpn`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
