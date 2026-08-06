import type { BillingProvider, BillingProviderKind } from "@foreclosuredata/types";
import { MockBillingProvider } from "./mock";
import { StripeBillingProvider } from "./stripe";
import { AuthorizeNetBillingProvider } from "./authorizeNet";

let cached: BillingProvider | null = null;

export function getActiveBillingProviderKind(): BillingProviderKind {
  const value = (process.env.BILLING_PROVIDER ?? "mock").toLowerCase();
  if (value === "authorize_net") return "AUTHORIZE_NET";
  if (value === "stripe") return "STRIPE";
  return "MOCK";
}

/** Selected once via BILLING_PROVIDER (authorize_net | stripe | mock — defaults to mock). Every checkout/subscription/refund call must go through this, never a provider SDK directly. */
export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  const kind = getActiveBillingProviderKind();
  cached = kind === "AUTHORIZE_NET" ? new AuthorizeNetBillingProvider() : kind === "STRIPE" ? new StripeBillingProvider() : new MockBillingProvider();
  return cached;
}

export { getPlanMapping, planKeyForInternalPlanId, billingIntervalForInternalPlanId } from "./planMappings";
