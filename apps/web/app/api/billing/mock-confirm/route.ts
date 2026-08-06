import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { MockBillingProvider } from "@/lib/billing/mock";
import { planKeyForInternalPlanId } from "@/lib/billing/planMappings";
import type { InternalPlanId } from "@foreclosuredata/types";

/**
 * Mock-provider-only stand-in for a real payment gateway's checkout
 * redirect + webhook. Only reachable when BILLING_PROVIDER=mock (the
 * default for local dev/tests) — Stripe and Authorize.net confirm through
 * their own webhook routes instead, never through a GET redirect.
 */
export async function GET(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.redirect(new URL("/sign-in", request.url));

  const { searchParams } = new URL(request.url);
  const internalPlanId = searchParams.get("internalPlanId") as InternalPlanId | null;
  const trialDays = Number(searchParams.get("trialDays") ?? "0");
  const redirect = searchParams.get("redirect") ?? "/settings/billing";

  if (!internalPlanId) return NextResponse.redirect(new URL("/pricing", request.url));

  const provider = new MockBillingProvider();
  const customer = await provider.createCustomer({ userId: profileId, email: "demo@example.com" });
  const subscription = await provider.createSubscription({ externalCustomerId: customer.externalCustomerId, internalPlanId, trialDays });

  await prisma.subscription.update({
    where: { profileId },
    data: {
      plan: planKeyForInternalPlanId(internalPlanId),
      status: subscription.status === "trialing" ? "TRIALING" : "ACTIVE",
      billingProvider: "MOCK",
      internalPlanId,
      externalCustomerId: subscription.externalCustomerId,
      externalSubscriptionId: subscription.externalSubscriptionId,
      trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    },
  });

  await prisma.paymentEvent.create({
    data: {
      profileId,
      billingProvider: "MOCK",
      type: "SUBSCRIPTION_CREATED",
      externalTransactionId: subscription.externalSubscriptionId,
      status: subscription.status,
    },
  });

  return NextResponse.redirect(new URL(redirect, request.url));
}
