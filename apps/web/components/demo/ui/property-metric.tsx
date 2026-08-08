import { cn } from "@/lib/utils";

export function PropertyMetric({
  label,
  value,
  emphasis = false,
  className,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={cn("tabular-nums text-neutral-900", emphasis ? "text-lg font-semibold" : "text-sm font-medium")}>{value}</span>
    </div>
  );
}
