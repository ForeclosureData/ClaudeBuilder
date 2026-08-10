"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatEquity, formatMoney, formatShortDate } from "@/lib/investor/format";
import type { InvestorListing } from "@/lib/investor/types";

type LocatedListing = InvestorListing & { lat: number; lng: number };

/**
 * A stylized, self-contained map panel -- pins are projected from each
 * listing's REAL Property.latitude/longitude into a simple bounding-box
 * view with subtle grid lines standing in for streets. Deliberately not a
 * tiled/interactive map library (no API key, no external tile fetches) --
 * the roadmap marks a true interactive map as a later, higher-priority-
 * future feature (docs/PRODUCT_UX_ROADMAP.md); this keeps the same
 * synchronized map/list UX pattern honestly, without a fabricated pin for
 * any listing that has no resolved coordinates yet.
 */
export function PropertyMap({
  listings,
  hoveredId,
  onHover,
  className,
}: {
  listings: InvestorListing[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const located = useMemo(
    () => listings.filter((l): l is LocatedListing => l.lat !== null && l.lng !== null),
    [listings],
  );

  const bounds = useMemo(() => {
    if (located.length === 0) return { minLat: 26.0, maxLat: 26.4, minLng: -98.5, maxLng: -97.9 };
    const lats = located.map((l) => l.lat);
    const lngs = located.map((l) => l.lng);
    const pad = 0.02;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [located]);

  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
    // Latitude increases northward, but CSS y increases downward.
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
    return { x, y };
  };

  const selected = located.find((l) => l.id === selectedId) ?? null;

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-neutral-200 bg-[#eef3f8]", className)}>
      <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden="true">
        {[15, 30, 45, 60, 75, 90].map((pct) => (
          <line key={`h-${pct}`} x1="0%" y1={`${pct}%`} x2="100%" y2={`${pct}%`} stroke="#c3d3e5" strokeWidth={1} />
        ))}
        {[10, 25, 40, 55, 70, 85].map((pct) => (
          <line key={`v-${pct}`} x1={`${pct}%`} y1="0%" x2={`${pct}%`} y2="100%" stroke="#c3d3e5" strokeWidth={1} />
        ))}
      </svg>

      {located.map((l) => {
        const { x, y } = project(l.lat, l.lng);
        const active = l.id === hoveredId || l.id === selectedId;
        return (
          <button
            key={l.id}
            type="button"
            aria-label={`${l.address ?? l.city ?? "Property"} — view on map`}
            style={{ left: `${x}%`, top: `${y}%` }}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition-all",
              active ? "z-10 h-4 w-4 bg-brand-700" : "h-3 w-3 bg-brand-500 hover:bg-brand-600",
            )}
            onMouseEnter={() => onHover(l.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => setSelectedId(l.id)}
          />
        );
      })}

      {selected && (
        <div
          className="absolute z-20 w-56 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
          style={{
            left: `${project(selected.lat, selected.lng).x}%`,
            top: `calc(${project(selected.lat, selected.lng).y}% - 12px)`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-2 top-2 text-neutral-400 hover:text-neutral-600"
            onClick={() => setSelectedId(null)}
          >
            ×
          </button>
          <div className="pr-4 text-sm font-semibold text-neutral-900">{selected.address ?? "Address not yet available"}</div>
          <div className="text-xs text-neutral-500">{selected.city}, {selected.state}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <span className="text-neutral-500">Sale</span>
            <span className="text-right font-medium text-neutral-900">{formatShortDate(selected.saleDateISO)}</span>
            <span className="text-neutral-500">County Value</span>
            <span className="text-right font-medium text-neutral-900">{formatMoney(selected.countyMarketValueCents ?? selected.countyAppraisedValueCents)}</span>
            <span className="text-neutral-500">Est. Equity</span>
            <span className="text-right font-medium text-neutral-900">{formatEquity(selected.estimatedEquityCents)}</span>
          </div>
          <Link href={`/properties/${selected.id}`} className="mt-2 block text-center text-xs font-medium text-brand-700 hover:underline">
            View Property →
          </Link>
        </div>
      )}

      {listings.length > 0 && located.length < listings.length && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs text-neutral-500 shadow">
          {located.length} of {listings.length} results have a mapped address
        </div>
      )}
    </div>
  );
}
