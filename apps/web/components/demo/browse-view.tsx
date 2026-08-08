"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/demo/ui/stat-card";
import { PropertyCard } from "@/components/demo/property-card";
import { PropertyCardSkeleton, StatCardSkeleton } from "@/components/demo/ui/skeletons";
import { FiltersPanel } from "@/components/demo/filters-panel";
import { FiltersDrawer } from "@/components/demo/filters-drawer";
import { ViewToggle, type ViewMode } from "@/components/demo/view-toggle";
import { MockMap } from "@/components/demo/mock-map";
import { EmptyState } from "@/components/properties/empty-state";
import { DEFAULT_DEMO_FILTERS, countActiveFilters, demoCityOptions, filterDemoCases, type DemoFilterState } from "@/lib/demo/filters";
import { formatShortDate } from "@/lib/demo/format";
import type { DemoCountySummary, DemoForeclosureCase } from "@/lib/demo/types";

export function BrowseView({
  cases,
  summary,
  initialView = "list",
}: {
  cases: DemoForeclosureCase[];
  summary: DemoCountySummary;
  initialView?: ViewMode;
}) {
  const [filters, setFilters] = useState<DemoFilterState>(DEFAULT_DEMO_FILTERS);
  const [view, setView] = useState<ViewMode>(initialView);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(t);
  }, []);

  const cities = useMemo(() => demoCityOptions(cases), [cases]);
  const results = useMemo(() => filterDemoCases(cases, filters), [cases, filters]);
  const activeFilterCount = countActiveFilters(filters);

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">{summary.countyName} Foreclosures</h1>
          <p className="mt-1 text-sm text-neutral-500">{summary.stateAbbr} · Sample listings for this demo</p>
        </div>
        <div className="rounded-md bg-neutral-50 px-3 py-2 text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Next Auction</div>
          <div className="text-sm font-semibold text-neutral-900">{formatShortDate(summary.nextAuctionISO)}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Active Foreclosures" value={summary.activeForeclosures} tone="brand" />
            <StatCard label="With Property Address" value={summary.withPropertyAddress} />
            <StatCard label="With County Value" value={summary.withCountyValue} />
            <StatCard label="New This Week" value={summary.newThisWeek} />
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-400">Sample data for this demo — not live production metrics.</p>

      <div className="sticky top-16 z-20 mt-6 flex flex-col gap-3 border-b border-neutral-200 bg-white/95 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Search address, owner, subdivision…"
              className="pl-9"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="md" className="md:hidden" onClick={() => setDrawerOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white">{activeFilterCount}</span>}
            </Button>
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        <FiltersPanel filters={filters} onChange={setFilters} cities={cities} className="hidden grid-cols-3 gap-3 md:grid lg:grid-cols-6" />
      </div>

      <FiltersDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} filters={filters} onChange={setFilters} cities={cities} resultCount={results.length} />

      <div className="mt-6 text-sm text-neutral-500">{loading ? "Loading…" : `${results.length} ${results.length === 1 ? "result" : "results"}`}</div>

      {view === "list" ? (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <PropertyCardSkeleton key={i} />)
          ) : results.length === 0 ? (
            <div className="lg:col-span-2">
              <EmptyState message="No foreclosures match your filters" hint="Try clearing a filter or broadening your search." />
            </div>
          ) : (
            results.map((c) => <PropertyCard key={c.id} demoCase={c} highlighted={c.id === hoveredId} onHover={setHoveredId} />)
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Hidden on mobile in map mode -- "toggle between map and list" means one at a time below lg; side-by-side (synchronized) from lg up. */}
          <div className="hidden max-h-[70vh] space-y-3 overflow-y-auto lg:col-span-2 lg:block">
            {results.length === 0 ? (
              <EmptyState message="No foreclosures match your filters" hint="Try clearing a filter or broadening your search." />
            ) : (
              results.map((c) => <PropertyCard key={c.id} demoCase={c} highlighted={c.id === hoveredId} onHover={setHoveredId} />)
            )}
          </div>
          <MockMap cases={results} hoveredId={hoveredId} onHover={setHoveredId} className="h-[65vh] lg:col-span-3 lg:h-[70vh]" />
        </div>
      )}
    </div>
  );
}
