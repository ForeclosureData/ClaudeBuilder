import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";

/** Stripe-only — Stripe's Billing Portal has no Authorize.net equivalent; that flow uses /settings/billing/payment-method instead. */
export async function POST() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const subscription = await prisma.subscription.findUnique({ where: { profileId } });
  if (!subscription?.externalCustomerId || subscription.billingProvider !== "STRIPE") {
    return NextResponse.json({ error: "No Stripe customer on file." }, { status: 400 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });

  const stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.externalCustomerId,
    return_url: `${appUrl}/settings/billing`,
  });

  return NextResponse.redirect(portal.url, { status: 303 });
}
