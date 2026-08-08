"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Frontend-only "saved properties" state for the investor demo. Backed by
 * localStorage so a save survives a page reload during a demo walkthrough,
 * but there is no server, no database row, and no account behind it --
 * this is intentionally NOT wired to apps/web/app/api/saved-properties.
 */
const STORAGE_KEY = "fd-demo-saved-property-ids";

interface SavedPropertiesContextValue {
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => void;
}

const SavedPropertiesContext = createContext<SavedPropertiesContextValue | null>(null);

export function DemoSavedPropertiesProvider({ children }: { children: ReactNode }) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Ignore -- start with an empty saved list.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...savedIds]));
  }, [savedIds, hydrated]);

  const toggleSaved = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const value = useMemo(() => ({ savedIds, isSaved, toggleSaved }), [savedIds, isSaved, toggleSaved]);

  return <SavedPropertiesContext.Provider value={value}>{children}</SavedPropertiesContext.Provider>;
}

export function useDemoSavedProperties(): SavedPropertiesContextValue {
  const ctx = useContext(SavedPropertiesContext);
  if (!ctx) throw new Error("useDemoSavedProperties must be used within DemoSavedPropertiesProvider");
  return ctx;
}
