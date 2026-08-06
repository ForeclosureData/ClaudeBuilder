import { prisma } from "@foreclosuredata/database";
import type { InternalPlanId, BillingProviderKind, BillingInterval } from "@foreclosuredata/types";

/** Looks up what a given internal plan SKU is called (and priced at) with a specific provider. Never hardcode a Stripe price ID or Authorize.net plan ref — always go through this. */
export async function getPlanMapping(internalPlanId: InternalPlanId, billingProvider: BillingProviderKind) {
  const mapping = await prisma.planMapping.findUnique({
    where: { internalPlanId_billingProvider: { internalPlanId, billingProvider } },
  });
  if (!mapping || !mapping.isActive) {
    throw new Error(`No active PlanMapping for ${internalPlanId} / ${billingProvider}. Seed or configure it before selling this plan.`);
  }
  return mapping;
}

export function planKeyForInternalPlanId(internalPlanId: InternalPlanId): "COUNTY" | "UNLIMITED" {
  return internalPlanId.startsWith("county_") ? "COUNTY" : "UNLIMITED";
}

export function billingIntervalForInternalPlanId(internalPlanId: InternalPlanId): BillingInterval {
  return internalPlanId.endsWith("_annual") ? "ANNUAL" : "MONTHLY";
}
