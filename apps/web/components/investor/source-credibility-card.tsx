import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/investor/format";
import type { InvestorListing } from "@/lib/investor/types";

export function SourceCredibilityCard({
  listing,
  countyName,
  sourceUrl,
  canViewSource,
}: {
  listing: InvestorListing;
  countyName: string;
  /** The real SourceDocument URL, only when the case has one on file. */
  sourceUrl: string | null;
  /** Whether the viewer's entitlement + plan allow opening the original document. */
  canViewSource: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <FileText className="h-4 w-4 text-brand-700" />
          Source & credibility
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-neutral-500">Source</dt>
            <dd className="font-medium text-neutral-900">{countyName} County foreclosure notice</dd>
          </div>
          <div>
            <dt className="text-neutral-500">County appraisal source</dt>
            <dd className="font-medium text-neutral-900">{countyName} County Appraisal District</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Appraisal year</dt>
            <dd className="font-medium text-neutral-900">{listing.appraisalYear ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Last retrieved</dt>
            <dd className="font-medium text-neutral-900">
              {listing.appraisalLastRetrievedISO ? formatShortDate(listing.appraisalLastRetrievedISO) : "Unavailable"}
            </dd>
          </div>
        </dl>
        {listing.hasSourceDocument ? (
          canViewSource && sourceUrl ? (
            <Link href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex text-sm font-medium text-brand-700 hover:underline">
              View Original Notice →
            </Link>
          ) : (
            <Link href="/pricing" className="inline-flex text-sm font-medium text-brand-700 hover:underline">
              Upgrade to view original notice →
            </Link>
          )
        ) : (
          <p className="text-sm text-neutral-500">Original notice not on file yet.</p>
        )}
        <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
          County appraisal values are used for property-tax purposes and may differ from current resale value.
        </p>
      </CardContent>
    </Card>
  );
}
