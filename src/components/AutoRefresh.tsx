"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface AutoRefreshProps {
  intervalMs?: number;
}

/** Re-renders the current server components periodically while the tab is visible. */
export function AutoRefresh({ intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
