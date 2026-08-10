import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PropertyMetric } from "@/components/investor/ui/property-metric";
import { SaveHeartButton } from "@/components/investor/save-heart-button";
import { formatEquity, formatMoney, formatShortDate, PROPERTY_TYPE_LABELS } from "@/lib/investor/format";
import type { InvestorListing } from "@/lib/investor/types";
import { cn } from "@/lib/utils";

export function PropertyCard({
  listing,
  highlighted = false,
  onHover,
}: {
  listing: InvestorListing;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const countyValueCents = listing.countyMarketValueCents ?? listing.countyAppraisedValueCents;

  return (
    <Card
      className={cn("group relative overflow-hidden transition-shadow hover:shadow-md", highlighted && "ring-2 ring-brand-500")}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <Link href={`/properties/${listing.id}`} className="block p-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-neutral-900">{listing.address ?? "Address not yet available"}</div>
            <div className="text-sm text-neutral-500">
              {listing.city ?? listing.subdivision ?? "Hidalgo County"}, {listing.state} {listing.zip}
            </div>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-md bg-brand-50 px-2.5 py-1.5 text-right">
            <div className="text-[10px] font-medium uppercase tracking-wide text-brand-600">Sale</div>
            <div className="text-sm font-semibold text-brand-800">{formatShortDate(listing.saleDateISO)}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PropertyMetric label="County Value" value={formatMoney(countyValueCents)} />
          <PropertyMetric label="Original Loan" value={listing.unlocked ? formatMoney(listing.originalLoanCents) : "Upgrade to view"} />
          <PropertyMetric label="Est. Equity" value={formatEquity(listing.estimatedEquityCents)} emphasis />
          <PropertyMetric label="Owner" value={listing.borrowerName} />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
            {PROPERTY_TYPE_LABELS[listing.propertyType]}
          </span>
          <span className="text-sm font-medium text-brand-700 group-hover:underline">View Property →</span>
        </div>
      </Link>

      <SaveHeartButton propertyId={listing.id} className="absolute right-3 top-3 bg-white/90 backdrop-blur" />
    </Card>
  );
}
