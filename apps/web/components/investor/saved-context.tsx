"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Real "saved properties" state, backed by /api/saved-properties (the same
 * endpoint the real watchlist page and lib/investor/adapter.ts's callers
 * already use) -- NOT localStorage. Signed-out visitors get an empty saved
 * set and toggling redirects to /sign-in, matching how the rest of the app
 * gates save actions on `profileId`.
 */
interface SavedPropertiesContextValue {
  isSaved: (propertyId: string) => boolean;
  toggleSaved: (propertyId: string) => void;
  isAuthenticated: boolean;
}

const SavedPropertiesContext = createContext<SavedPropertiesContextValue | null>(null);

export function SavedPropertiesProvider({ children, isAuthenticated, initialSavedIds = [] }: { children: ReactNode; isAuthenticated: boolean; initialSavedIds?: string[] }) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(initialSavedIds));

  useEffect(() => {
    if (!isAuthenticated || initialSavedIds.length > 0) return;
    fetch("/api/saved-properties")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: Array<{ propertyId: string }> } | null) => {
        if (data?.items) setSavedIds(new Set(data.items.map((i) => i.propertyId)));
      })
      .catch(() => {
        // Leave savedIds empty -- a failed fetch shouldn't block browsing, just leaves hearts unfilled until retried.
      });
    // Only ever refetches when auth state changes -- initialSavedIds seeds the very first render so this effect doesn't need to depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const toggleSaved = useCallback(
    (propertyId: string) => {
      if (!isAuthenticated) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const wasSaved = savedIds.has(propertyId);
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(propertyId);
        else next.add(propertyId);
        return next;
      });
      const request = wasSaved
        ? fetch(`/api/saved-properties/${propertyId}`, { method: "DELETE" })
        : fetch("/api/saved-properties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId }) });
      request.catch(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(propertyId);
          else next.delete(propertyId);
          return next;
        });
      });
    },
    [isAuthenticated, savedIds],
  );

  const isSaved = useCallback((propertyId: string) => savedIds.has(propertyId), [savedIds]);
  const value = useMemo(() => ({ isSaved, toggleSaved, isAuthenticated }), [isSaved, toggleSaved, isAuthenticated]);

  return <SavedPropertiesContext.Provider value={value}>{children}</SavedPropertiesContext.Provider>;
}

export function useSavedProperties(): SavedPropertiesContextValue {
  const ctx = useContext(SavedPropertiesContext);
  if (!ctx) throw new Error("useSavedProperties must be used within SavedPropertiesProvider");
  return ctx;
}
