"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedProperties } from "@/components/investor/saved-context";

export function SaveHeartButton({ propertyId, className }: { propertyId: string; className?: string }) {
  const { isSaved, toggleSaved } = useSavedProperties();
  const saved = isSaved(propertyId);

  return (
    <button
      type="button"
      aria-label={saved ? "Remove from saved properties" : "Save property"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(propertyId);
      }}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 transition-colors hover:border-danger-200 hover:text-danger-500",
        saved && "border-danger-200 text-danger-500",
        className,
      )}
    >
      <Heart className={cn("h-4 w-4", saved && "fill-current")} />
    </button>
  );
}
