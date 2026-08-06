import { prisma } from "@foreclosuredata/database";
import type { Entitlement } from "@foreclosuredata/types";

/**
 * The single source of truth for "what can this user do." Every API route
 * that serves foreclosure data, accepts a save, or starts an export must
 * call this — never trust a plan/entitlement value the client supplies.
 *
 * Reads Subscription + PlanConfig from Postgres directly (via the
 * service-role Prisma connection), independent of whatever the Supabase
 * session claims.
 *
 * Three tiers: FREE (browse-only preview, no county fully unlocked),
 * COUNTY (one selected county, $7/mo), UNLIMITED (every county, $27/mo).
 */
export async function resolveEntitlement(profileId: string | null): Promise<Entitlement> {
  const freePlan = await prisma.planConfig.findUnique({ where: { planKey: "FREE" } });
  if (!freePlan) {
    throw new Error("PlanConfig for FREE is missing — run the database seed before serving requests.");
  }

  if (!profileId) {
    return freeEntitlement(freePlan);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { profileId },
    include: { selectedCounty: true },
  });

  const inGoodStanding = subscription && ["ACTIVE", "TRIALING", "PROMOTIONAL"].includes(subscription.status);
  const inPaymentGracePeriod =
    subscription &&
    ["PAST_DUE", "PAYMENT_FAILED"].includes(subscription.status) &&
    subscription.paymentGracePeriodEndsAt &&
    subscription.paymentGracePeriodEndsAt.getTime() > Date.now();

  if (!subscription || !(inGoodStanding || inPaymentGracePeriod) || subscription.plan === "FREE") {
    return freeEntitlement(freePlan);
  }

  const planConfig = await prisma.planConfig.findUnique({ where: { planKey: subscription.plan } });
  if (!planConfig) {
    return freeEntitlement(freePlan);
  }

  const availableCounties: string[] | "ALL" =
    subscription.plan === "UNLIMITED" ? "ALL" : subscription.selectedCounty ? [subscription.selectedCounty.slug] : [];

  return {
    plan: subscription.plan,
    availableCounties,
    selectedCountySlug: subscription.selectedCounty?.slug ?? null,
    maxSavedProperties: planConfig.maxSavedProperties,
    canExportCsv: planConfig.monthlyCsvExportLimit > 0,
    monthlyCsvExportLimit: planConfig.monthlyCsvExportLimit,
    csvExportsUsedThisMonth: subscription.csvExportsUsedThisMonth,
    canViewDocuments: planConfig.canViewDocuments,
    canReceiveAlerts: planConfig.canReceiveAlerts,
    canViewRecordHistory: planConfig.canViewRecordHistory,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
  };
}

function freeEntitlement(freePlan: {
  maxSavedProperties: number;
  monthlyCsvExportLimit: number;
  canViewDocuments: boolean;
  canReceiveAlerts: boolean;
  canViewRecordHistory: boolean;
}): Entitlement {
  return {
    plan: "FREE",
    availableCounties: [],
    selectedCountySlug: null,
    maxSavedProperties: freePlan.maxSavedProperties,
    canExportCsv: freePlan.monthlyCsvExportLimit > 0,
    monthlyCsvExportLimit: freePlan.monthlyCsvExportLimit,
    csvExportsUsedThisMonth: 0,
    canViewDocuments: freePlan.canViewDocuments,
    canReceiveAlerts: freePlan.canReceiveAlerts,
    canViewRecordHistory: freePlan.canViewRecordHistory,
    trialEndsAt: null,
  };
}

/** Server-side check used before returning any per-record field that's plan-gated. */
export function assertCanViewDocuments(entitlement: Entitlement) {
  if (!entitlement.canViewDocuments) {
    throw new EntitlementError("Viewing source documents requires a paid plan.");
  }
}

export class EntitlementError extends Error {}
