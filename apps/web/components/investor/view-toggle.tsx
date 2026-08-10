"use client";

import { List, Map } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "list" | "map";

export function ViewToggle({ value, onChange, className }: { value: ViewMode; onChange: (mode: ViewMode) => void; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-md border border-neutral-200 bg-white p-0.5 dark:border-neutral-700 dark:bg-neutral-900", className)}>
      {(
        [
          { mode: "list" as const, label: "List", Icon: List },
          { mode: "map" as const, label: "Map", Icon: Map },
        ]
      ).map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            value === mode ? "bg-brand-600 text-white" : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
