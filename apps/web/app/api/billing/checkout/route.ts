import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getBillingProvider, getActiveBillingProviderKind, getPlanMapping, planKeyForInternalPlanId } from "@/lib/billing";

const TRIAL_DAYS = 7;

const checkoutSchema = z.object({
  internalPlanId: z.enum(["county_monthly", "county_annual", "texas_monthly", "texas_annual"]),
  countySlug: z.string().optional(),
});

/**
 * Initiates checkout for the selected plan. Access is granted only once
 * the backend confirms payment/subscription status (via webhook or, for
 * the mock provider, the mock-confirm endpoint) — never merely because
 * the browser lands back on a "success" URL.
 */
export async function POST(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const mapping = await getPlanMapping(parsed.data.internalPlanId, getActiveBillingProviderKind());
  const provider = getBillingProvider();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

  const session = await provider.createCheckoutSession({
    userId: profileId,
    internalPlanId: parsed.data.internalPlanId,
    trialDays: TRIAL_DAYS,
    successUrl: `${appUrl}/settings/billing?checkout=success`,
    cancelUrl: `${appUrl}/pricing?checkout=canceled`,
  });

  // Record intent so the mock-confirm / webhook handler knows which plan
  // and county this checkout was for once it comes back.
  await prisma.subscription.upsert({
    where: { profileId },
    update: { internalPlanId: parsed.data.internalPlanId, plan: planKeyForInternalPlanId(parsed.data.internalPlanId), status: "INCOMPLETE" },
    create: {
      profileId,
      internalPlanId: parsed.data.internalPlanId,
      plan: planKeyForInternalPlanId(parsed.data.internalPlanId),
      status: "INCOMPLETE",
      selectedCountyId: parsed.data.countySlug
        ? (await prisma.county.findUnique({ where: { slug: parsed.data.countySlug } }))?.id
        : undefined,
    },
  });

  return NextResponse.json({ url: session.url, priceCents: mapping.priceCents, trialDays: TRIAL_DAYS });
}
