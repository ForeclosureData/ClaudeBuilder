"use client";

import { useEffect } from "react";

/** Registers the PWA service worker. Silently no-ops if unsupported. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app works fine without a service worker.
    });
  }, []);
  return null;
}
