import { Badge } from "@/components/ui/badge";
import { confidenceLabel, confidenceTone } from "@foreclosuredata/config";

export function ConfidenceBadge({ confidence, label }: { confidence: number | null | undefined; label?: string }) {
  const tone = confidenceTone(confidence);
  return (
    <Badge tone={tone} title={confidenceLabel(confidence)}>
      {label ?? confidenceLabel(confidence)}
      {confidence !== null && confidence !== undefined ? ` (${Math.round(confidence * 100)}%)` : ""}
    </Badge>
  );
}

export function EstimatedBadge() {
  return <Badge tone="warning">Estimated — not verified</Badge>;
}
