import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  success: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500",
  warning: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500",
  danger: "bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
