/**
 * PLACEHOLDER pricing for the investor demo -- NOT final product pricing.
 * See docs/PRODUCT_UX_ROADMAP.md's "Pricing — NOT FINAL" section: current
 * working numbers ($7/mo county, $27/mo Texas-wide) are still under review
 * against LandGlide and comparable products, so this demo intentionally
 * shows "Coming soon" rather than committing to a figure. Edit
 * DEMO_PRICING_PLANS below (all in one place) once real pricing is set --
 * nothing else in the demo needs to change.
 */
export interface DemoPricingPlan {
  id: string;
  name: string;
  priceLabel: string;
  cadence: string | null;
  description: string;
  features: string[];
  highlighted?: boolean;
}

export const DEMO_PRICING_PLANS: DemoPricingPlan[] = [
  {
    id: "single-county",
    name: "Single County",
    priceLabel: "Coming soon",
    cadence: null,
    description: "Full access to one Texas county's foreclosure inventory.",
    features: ["Unlimited searches in your county", "Property alerts", "Save & track properties", "Original source notices"],
  },
  {
    id: "texas-access",
    name: "Texas Access",
    priceLabel: "Coming soon",
    cadence: null,
    description: "Every supported Texas county, in one place.",
    features: ["Everything in Single County", "All supported counties statewide", "Priority access to new counties", "Export to CSV"],
    highlighted: true,
  },
];
