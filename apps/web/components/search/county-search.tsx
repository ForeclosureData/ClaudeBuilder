"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface CountyOption {
  slug: string;
  name: string;
  state: string;
  isActive: boolean;
}

/**
 * The homepage's primary action: type a Texas county, see it instantly,
 * go straight to its public preview — no login. Data comes from the small
 * cached /api/counties list (≤254 rows), filtered client-side.
 */
export function CountySearch({ autoFocus, size = "lg" }: { autoFocus?: boolean; size?: "lg" | "sm" }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [counties, setCounties] = useState<CountyOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/counties")
      .then((r) => r.json())
      .then(setCounties)
      .catch(() => setCounties([]));
  }, []);

  const matches = useMemo(() => {
    if (!query.trim()) return counties.slice(0, 6);
    const q = query.toLowerCase();
    return counties.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, counties]);

  function go(slug: string) {
    setOpen(false);
    router.push(`/county/${slug}`);
  }

  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900",
          size === "lg" ? "h-14" : "h-11",
        )}
      >
        <Search className="h-5 w-5 shrink-0 text-neutral-400" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) go(matches[0].slug);
          }}
          placeholder="Search a Texas county…"
          className={cn(
            "w-full bg-transparent text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-50",
            size === "lg" ? "text-lg" : "text-sm",
          )}
        />
      </div>

      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {matches.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(c.slug)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-50">{c.name} County</span>
                {!c.isActive && <span className="text-xs text-neutral-400">Coming soon</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
