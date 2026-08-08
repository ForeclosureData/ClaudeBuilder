"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatEquity, formatMoney, formatShortDate } from "@/lib/demo/format";
import type { DemoForeclosureCase } from "@/lib/demo/types";

/**
 * A stylized, self-contained map visualization -- NOT a real map. Pins are
 * projected from each case's mock lat/lng into a simple bounding-box panel
 * with subtle grid lines standing in for streets. Deliberately avoids
 * pulling in a real map/tile library (and any associated API key) since
 * this only needs to demonstrate the synchronized map/list UX pattern.
 */
export function MockMap({
  cases,
  hoveredId,
  onHover,
  className,
}: {
  cases: DemoForeclosureCase[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bounds = useMemo(() => {
    if (cases.length === 0) return { minLat: 26, maxLat: 26.4, minLng: -98.5, maxLng: -97.9 };
    const lats = cases.map((c) => c.lat);
    const lngs = cases.map((c) => c.lng);
    const pad = 0.02;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [cases]);

  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
    // Latitude increases northward, but CSS y increases downward.
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
    return { x, y };
  };

  const selected = cases.find((c) => c.id === selectedId) ?? null;

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

      {cases.map((c) => {
        const { x, y } = project(c.lat, c.lng);
        const active = c.id === hoveredId || c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            aria-label={`${c.address ?? c.city} — view on map`}
            style={{ left: `${x}%`, top: `${y}%` }}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition-all",
              active ? "z-10 h-4 w-4 bg-brand-700" : "h-3 w-3 bg-brand-500 hover:bg-brand-600",
            )}
            onMouseEnter={() => onHover(c.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => setSelectedId(c.id)}
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
          <div className="pr-4 text-sm font-semibold text-neutral-900">{selected.address ?? "Address pending review"}</div>
          <div className="text-xs text-neutral-500">{selected.city}, {selected.state}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <span className="text-neutral-500">Sale</span>
            <span className="text-right font-medium text-neutral-900">{formatShortDate(selected.saleDateISO)}</span>
            <span className="text-neutral-500">County Value</span>
            <span className="text-right font-medium text-neutral-900">{formatMoney(selected.countyMarketValueCents)}</span>
            <span className="text-neutral-500">Est. Equity</span>
            <span className="text-right font-medium text-neutral-900">{formatEquity(selected.estimatedEquityCents)}</span>
          </div>
          <Link href={`/demo/property/${selected.id}`} className="mt-2 block text-center text-xs font-medium text-brand-700 hover:underline">
            View Property →
          </Link>
        </div>
      )}
    </div>
  );
}
