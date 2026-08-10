import { Select, Label } from "@/components/ui/input";
import type { InvestorFilterState } from "@/lib/investor/filters";
import { PROPERTY_TYPE_LABELS } from "@/lib/investor/format";
import type { InvestorPropertyType } from "@/lib/investor/types";

const SALE_DATE_OPTIONS: { value: InvestorFilterState["saleDate"]; label: string }[] = [
  { value: "ANY", label: "Any time" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "NEXT_60_DAYS", label: "Next 60 days" },
];

const PROPERTY_TYPE_OPTIONS: { value: InvestorPropertyType | "ANY"; label: string }[] = [
  { value: "ANY", label: "Any type" },
  ...(Object.keys(PROPERTY_TYPE_LABELS) as InvestorPropertyType[])
    .filter((t) => t !== "UNKNOWN")
    .map((t) => ({ value: t, label: PROPERTY_TYPE_LABELS[t] })),
];

const EQUITY_OPTIONS: { value: InvestorFilterState["equity"]; label: string }[] = [
  { value: "ANY", label: "Any equity" },
  { value: "UNDER_25K", label: "Under $25k" },
  { value: "25K_75K", label: "$25k – $75k" },
  { value: "OVER_75K", label: "Over $75k" },
  { value: "UNAVAILABLE", label: "Unavailable" },
];

export function FiltersPanel({
  filters,
  onChange,
  cities,
  className,
}: {
  filters: InvestorFilterState;
  onChange: (next: InvestorFilterState) => void;
  cities: string[];
  className?: string;
}) {
  const set = <K extends keyof InvestorFilterState>(key: K, value: InvestorFilterState[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className={className ? className : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"}>
      <div>
        <Label htmlFor="filter-city">City</Label>
        <Select id="filter-city" value={filters.city} onChange={(e) => set("city", e.target.value)}>
          <option value="">All cities</option>
          {cities.map((city) => (
            <option key={city} value={city}>{city}</option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="filter-sale-date">Sale date</Label>
        <Select id="filter-sale-date" value={filters.saleDate} onChange={(e) => set("saleDate", e.target.value as InvestorFilterState["saleDate"])}>
          {SALE_DATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="filter-property-type">Property type</Label>
        <Select id="filter-property-type" value={filters.propertyType} onChange={(e) => set("propertyType", e.target.value as InvestorFilterState["propertyType"])}>
          {PROPERTY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="filter-equity">Estimated equity</Label>
        <Select id="filter-equity" value={filters.equity} onChange={(e) => set("equity", e.target.value as InvestorFilterState["equity"])}>
          {EQUITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </div>

      <label className="flex items-end gap-2 pb-2.5 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500 dark:border-neutral-600"
          checked={filters.hasCountyValue}
          onChange={(e) => set("hasCountyValue", e.target.checked)}
        />
        Has county value
      </label>

      <label className="flex items-end gap-2 pb-2.5 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500 dark:border-neutral-600"
          checked={filters.hasStreetAddress}
          onChange={(e) => set("hasStreetAddress", e.target.checked)}
        />
        Has street address
      </label>

      <label className="flex items-end gap-2 pb-2.5 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500 dark:border-neutral-600"
          checked={filters.newlyAdded}
          onChange={(e) => set("newlyAdded", e.target.checked)}
        />
        Newly added
      </label>
    </div>
  );
}
