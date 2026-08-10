import { cn } from "@/lib/utils";

export function PropertyMetric({
  label,
  value,
  emphasis = false,
  locked = false,
  className,
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
  /** Renders a blurred placeholder instead of `value` -- for entitlement-gated fields, so a paywalled card reads as "there's a real value here" rather than repeating "Upgrade to view" as plain text in every locked slot. */
  locked?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      {locked ? (
        <span
          aria-label="Upgrade to view"
          className={cn(
            "inline-block w-16 select-none rounded bg-neutral-200 text-transparent blur-[3px] dark:bg-neutral-700",
            emphasis ? "text-lg font-semibold" : "text-sm font-medium",
          )}
        >
          ••••••
        </span>
      ) : (
        <span className={cn("tabular-nums text-neutral-900", emphasis ? "text-lg font-semibold" : "text-sm font-medium")}>{value}</span>
      )}
    </div>
  );
}
