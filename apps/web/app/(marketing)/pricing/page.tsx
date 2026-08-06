import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const plans = [
  {
    key: "FREE",
    name: "Free",
    price: "$0",
    description: "Browse counties",
    features: ["Browse every county page", "Limited preview (city + sale date)", "No property details"],
    cta: "Start browsing",
    href: "/",
  },
  {
    key: "COUNTY",
    name: "County Plan",
    price: "$7",
    description: "Choose one county",
    features: [
      "Unlimited viewing for one county",
      "AI summaries",
      "Original documents",
      "Property history",
      "Search & filters",
      "Save properties",
      "Basic alerts",
    ],
    cta: "Start 7-day free trial",
    href: "/sign-up?plan=county",
  },
  {
    key: "UNLIMITED",
    name: "Texas Unlimited",
    price: "$27",
    description: "Every supported county",
    features: [
      "Access every currently supported Texas county, including newly added counties as they launch",
      "Unlimited search",
      "Unlimited saved properties",
      "CSV exports",
      "Advanced alerts",
      "Future features included",
    ],
    cta: "Start 7-day free trial",
    href: "/sign-up?plan=unlimited",
    highlight: true,
  },
];

export default function PricingPage() {
  return (
    <div className="container-page py-16">
      <h1 className="text-center text-3xl font-bold text-neutral-900 dark:text-neutral-50">Simple pricing</h1>
      <p className="mx-auto mt-2 max-w-md text-center text-neutral-500">
        Every plan starts with a 7-day free trial. Cancel anytime.
      </p>
      <p className="mx-auto mt-2 max-w-md text-center text-sm text-brand-600 dark:text-brand-400">
        The first 100 approved founding users get 3 months free.
      </p>

      <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.key} className={cn("relative", plan.highlight && "border-brand-500 ring-1 ring-brand-500")}>
            {plan.highlight && (
              <Badge tone="brand" className="absolute -top-3 left-1/2 -translate-x-1/2">Best value</Badge>
            )}
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <p className="mt-1 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
                {plan.price}
                {plan.price !== "$0" && <span className="text-sm font-normal text-neutral-500">/mo</span>}
              </p>
              <p className="text-sm text-neutral-500">{plan.description}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                {plan.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              <Link href={plan.href} className="mt-6 block">
                <Button className="w-full" variant={plan.highlight ? "primary" : "outline"}>{plan.cta}</Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-md text-center text-xs text-neutral-400">
        ForeclosureData organizes public-record foreclosure information. It is not a consumer
        reporting agency and may not be used for credit, employment, tenant, insurance, or other
        FCRA-regulated eligibility decisions.
      </p>
    </div>
  );
}
