"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FiltersPanel } from "@/components/demo/filters-panel";
import { DEFAULT_DEMO_FILTERS, type DemoFilterState } from "@/lib/demo/filters";

export function FiltersDrawer({
  open,
  onClose,
  filters,
  onChange,
  cities,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  filters: DemoFilterState;
  onChange: (next: DemoFilterState) => void;
  cities: string[];
  resultCount: number;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-neutral-900/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Filters</h2>
          <button type="button" aria-label="Close filters" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <FiltersPanel filters={filters} onChange={onChange} cities={cities} className="grid grid-cols-1 gap-4" />

        <div className="mt-6 flex gap-2 border-t border-neutral-100 pt-4">
          <Button variant="outline" className="flex-1" onClick={() => onChange({ ...DEFAULT_DEMO_FILTERS, query: filters.query })}>
            Clear all
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Show {resultCount} results
          </Button>
        </div>
      </div>
    </div>
  );
}
