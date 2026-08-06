"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SaveButton({ propertyId, initiallySaved }: { propertyId: string; initiallySaved: boolean }) {
  const [saved, setSaved] = useState(initiallySaved);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      if (saved) {
        await fetch(`/api/saved-properties/${propertyId}`, { method: "DELETE" });
      } else {
        await fetch("/api/saved-properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyId }),
        });
      }
      setSaved(!saved);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={saved ? "secondary" : "outline"} size="sm" onClick={toggle} disabled={loading}>
      {saved ? "Saved to watchlist" : "Save to watchlist"}
    </Button>
  );
}
