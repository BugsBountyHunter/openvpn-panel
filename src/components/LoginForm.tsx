"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface LoginFormProps {
  next: string;
  demoHint: boolean;
}

export function LoginForm({ next, demoHint }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Sign-in failed");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the panel");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        <input id="username" autoComplete="username" required value={username}
          onChange={(e) => setUsername(e.target.value)} className={input} autoFocus />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={busy}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {demoHint ? (
        <p className="text-center text-xs text-muted">Demo mode: sign in as <code>admin</code> / <code>demo</code>.</p>
      ) : null}
    </form>
  );
}
