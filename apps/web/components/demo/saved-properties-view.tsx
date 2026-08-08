"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertyCard } from "@/components/demo/property-card";
import { useDemoSavedProperties } from "@/lib/demo/saved-context";
import type { DemoForeclosureCase } from "@/lib/demo/types";

export function SavedPropertiesView({ cases }: { cases: DemoForeclosureCase[] }) {
  const { savedIds } = useDemoSavedProperties();
  const saved = cases.filter((c) => savedIds.has(c.id));

  return (
    <div className="container-page py-6 sm:py-8">
      <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">Saved Properties</h1>
      <p className="mt-1 text-sm text-neutral-500">Properties you've saved in this demo session, stored locally on this device.</p>

      {saved.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <Heart className="h-8 w-8 text-neutral-300" />
          <p className="font-medium text-neutral-700">No saved properties yet</p>
          <p className="max-w-sm text-sm text-neutral-400">Tap the heart on any foreclosure card or property page to save it here.</p>
          <Link href="/demo/browse">
            <Button className="mt-2">Browse Foreclosures</Button>
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {saved.map((c) => (
            <PropertyCard key={c.id} demoCase={c} />
          ))}
        </div>
      )}
    </div>
  );
}
