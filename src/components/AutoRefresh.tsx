"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatAge } from "@/lib/format";

interface AutoRefreshProps {
  intervalMs?: number;
  /** Server render time of the data on screen (epoch ms). */
  updatedAt: number;
}

// Pause is a per-browser convenience; storage may be unavailable (private mode).
const PAUSE_KEY = "openvpn-panel:auto-refresh-paused";
const PAUSE_EVENT = "openvpn-panel:auto-refresh";

function readPaused(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePaused(paused: boolean): void {
  try {
    if (paused) window.localStorage.setItem(PAUSE_KEY, "1");
    else window.localStorage.removeItem(PAUSE_KEY);
  } catch {
    // Not persisted; the toggle still works for this page view via the event.
  }
  window.dispatchEvent(new Event(PAUSE_EVENT));
}

function subscribePaused(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(PAUSE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PAUSE_EVENT, onChange);
  };
}

/**
 * Re-renders the current server components periodically while the tab is
 * visible, shows how fresh the data is, and lets the admin pause updates.
 */
export function AutoRefresh({ intervalMs = 5000, updatedAt }: AutoRefreshProps) {
  const router = useRouter();
  const paused = useSyncExternalStore(subscribePaused, readPaused, () => false);
  // Starts at the server time so the first client render matches the server.
  const [clock, setClock] = useState(updatedAt);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (paused) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refreshIfVisible, intervalMs);
    // Catch up straight away when the admin comes back to the tab.
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, intervalMs, paused]);

  const age = formatAge(Math.max(0, clock - updatedAt));
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="tabular-nums">
        <span aria-hidden className={paused ? "text-muted" : "text-ok"}>●</span> {paused ? "Paused" : "Live"} · updated{" "}
        {age}
      </span>
      <button
        type="button"
        onClick={() => writePaused(!paused)}
        aria-pressed={paused}
        className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-2 hover:text-text"
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
