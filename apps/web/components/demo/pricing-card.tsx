import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DemoPricingPlan } from "@/lib/demo/fixtures/pricing";

export function PricingCard({ plan }: { plan: DemoPricingPlan }) {
  return (
    <Card className={cn("flex flex-col p-6", plan.highlighted && "border-brand-300 ring-1 ring-brand-200")}>
      {plan.highlighted && (
        <span className="mb-3 inline-block w-fit rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">Most popular</span>
      )}
      <h3 className="text-lg font-semibold text-neutral-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-neutral-500">{plan.description}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-neutral-900">{plan.priceLabel}</span>
        {plan.cadence && <span className="text-sm text-neutral-500">/{plan.cadence}</span>}
      </div>
      <ul className="mt-6 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-neutral-600">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
            {feature}
          </li>
        ))}
      </ul>
      <Button className="mt-6" variant={plan.highlighted ? "primary" : "outline"}>
        Notify Me
      </Button>
    </Card>
  );
}
