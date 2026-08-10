import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "brand";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900", className)}>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums sm:text-3xl",
          tone === "brand" ? "text-brand-700 dark:text-brand-400" : "text-neutral-900 dark:text-neutral-50",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-neutral-500">{label}</div>
    </div>
  );
}
