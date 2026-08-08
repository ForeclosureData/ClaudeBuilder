import { CheckCircle2, MapPin, DollarSign, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DATA_STATUS_LABELS } from "@/lib/demo/format";
import type { DemoDataStatus } from "@/lib/demo/types";

const ICONS: Record<DemoDataStatus, React.ComponentType<{ className?: string }>> = {
  COUNTY_VERIFIED: CheckCircle2,
  ADDRESS_RESOLVED: MapPin,
  VALUE_AVAILABLE: DollarSign,
  NEEDS_REVIEW: AlertCircle,
};

const TONES: Record<DemoDataStatus, "success" | "brand" | "neutral" | "warning"> = {
  COUNTY_VERIFIED: "success",
  ADDRESS_RESOLVED: "brand",
  VALUE_AVAILABLE: "brand",
  NEEDS_REVIEW: "warning",
};

export function StatusBadges({ statuses, className }: { statuses: DemoDataStatus[]; className?: string }) {
  return (
    <div className={className ? className : "flex flex-wrap gap-1.5"}>
      {statuses.map((status) => {
        const Icon = ICONS[status];
        return (
          <Badge key={status} tone={TONES[status]} className="gap-1 font-normal">
            <Icon className="h-3 w-3" />
            {DATA_STATUS_LABELS[status]}
          </Badge>
        );
      })}
    </div>
  );
}
