"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50">
      Sign out
    </button>
  );
}
