import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/demo/format";
import type { DemoForeclosureCase } from "@/lib/demo/types";

export function SourceCredibilityCard({ demoCase }: { demoCase: DemoForeclosureCase }) {
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
            <dd className="font-medium text-neutral-900">Hidalgo County foreclosure notice</dd>
          </div>
          <div>
            <dt className="text-neutral-500">County appraisal source</dt>
            <dd className="font-medium text-neutral-900">Hidalgo County Appraisal District</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Appraisal year</dt>
            <dd className="font-medium text-neutral-900">{demoCase.appraisalYear ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Last retrieved</dt>
            <dd className="font-medium text-neutral-900">
              {demoCase.appraisalLastRetrievedISO ? formatShortDate(demoCase.appraisalLastRetrievedISO) : "Unavailable"}
            </dd>
          </div>
        </dl>
        <Link href={`/demo/source/${demoCase.id}`} className="inline-flex text-sm font-medium text-brand-700 hover:underline">
          View Original Notice →
        </Link>
        <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
          County appraisal values are used for property-tax purposes and may differ from current resale value.
        </p>
      </CardContent>
    </Card>
  );
}
