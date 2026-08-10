import { CheckCircle2, MapPin, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InvestorDataState } from "@/lib/investor/types";

/**
 * Renders the single, simple investor-facing state label -- sourced from
 * InvestorListing.dataState, which is itself computed by
 * computePublicationStatus()'s investorLabel (see lib/investor/adapter.ts).
 * Never shows a raw confidence number or an internal review-reason code
 * like CAD_OWNER_CONFLICT.
 */
const ICONS: Record<InvestorDataState, React.ComponentType<{ className?: string }>> = {
  "Verified property": CheckCircle2,
  "Source address": MapPin,
  "Limited data": AlertCircle,
  "Limited data — address pending": AlertCircle,
  "Pending verification": AlertCircle,
  Unavailable: AlertCircle,
};

const TONES: Record<InvestorDataState, "success" | "brand" | "neutral" | "warning"> = {
  "Verified property": "success",
  "Source address": "brand",
  "Limited data": "warning",
  "Limited data — address pending": "warning",
  "Pending verification": "neutral",
  Unavailable: "neutral",
};

export function StatusBadge({ dataState, className }: { dataState: InvestorDataState; className?: string }) {
  const Icon = ICONS[dataState];
  return (
    <Badge tone={TONES[dataState]} className={className ? className : "gap-1 font-normal"}>
      <Icon className="h-3 w-3" />
      {dataState}
    </Badge>
  );
}
