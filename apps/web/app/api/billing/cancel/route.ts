import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getBillingProvider } from "@/lib/billing";

/** Self-service cancellation defaults to cancel-at-period-end — never deceptive, access continues through what's already been paid for. Immediate cancellation is an admin-only action (see the admin dashboard). */
export async function POST() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const subscription = await prisma.subscription.findUnique({ where: { profileId } });
  if (!subscription?.externalSubscriptionId) {
    return NextResponse.json({ error: "No active subscription." }, { status: 400 });
  }

  const provider = getBillingProvider();
  const updated = await provider.cancelSubscription(subscription.externalSubscriptionId, true);

  await prisma.subscription.update({
    where: { profileId },
    data: { cancelAtPeriodEnd: true, status: updated.status === "canceled" ? "CANCELED" : subscription.status },
  });

  return NextResponse.redirect(new URL("/settings/billing", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"), { status: 303 });
}
