import type { Metadata } from "next";
import { PricingCard } from "@/components/demo/pricing-card";
import { DEMO_PRICING_PLANS } from "@/lib/demo/fixtures/pricing";

export const metadata: Metadata = { title: "Pricing — ForeclosureData Demo" };

export default function DemoPricingPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-3xl font-semibold text-neutral-900">Simple, county-based pricing</h1>
        <p className="mt-3 text-neutral-500">
          Plans starting at <span className="font-medium text-neutral-700">Coming soon</span>. We're finalizing pricing — final
          numbers will be published before launch.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
        {DEMO_PRICING_PLANS.map((plan) => (
          <PricingCard key={plan.id} plan={plan} />
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-xl text-center text-xs text-neutral-400">
        Pricing shown here is a placeholder for demo purposes and is not final.
      </p>
    </div>
  );
}
