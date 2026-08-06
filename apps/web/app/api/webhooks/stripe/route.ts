import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@foreclosuredata/database";

/**
 * Stripe webhook — signature-verified, idempotent (WebhookEvent's unique
 * constraint on (provider, externalEventId) rejects redeliveries), and the
 * only place a Stripe subscription status change reaches our database.
 * Access is never granted just because the browser redirected to a
 * success URL; it's granted here, after Stripe confirms the event.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 });
  }

  const existing = await prisma.webhookEvent.findUnique({
    where: { billingProvider_externalEventId: { billingProvider: "STRIPE", externalEventId: event.id } },
  });
  if (existing) return NextResponse.json({ ok: true, deduplicated: true });

  await prisma.webhookEvent.create({
    data: { billingProvider: "STRIPE", externalEventId: event.id, eventType: event.type, payload: event as unknown as object },
  });

  await handleStripeEvent(event);

  await prisma.webhookEvent.update({
    where: { billingProvider_externalEventId: { billingProvider: "STRIPE", externalEventId: event.id } },
    data: { processedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const profileId = sub.metadata?.userId;
      if (!profileId) return;
      await prisma.subscription.updateMany({
        where: { profileId },
        data: {
          status: mapStripeStatus(sub.status),
          externalCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          externalSubscriptionId: sub.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await prisma.subscription.updateMany({
        where: { externalSubscriptionId: sub.id },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (!subscriptionId) return;
      const graceDays = Number(process.env.PAYMENT_FAILURE_GRACE_PERIOD_DAYS ?? "7");
      await prisma.subscription.updateMany({
        where: { externalSubscriptionId: subscriptionId },
        data: { status: "PAYMENT_FAILED", paymentGracePeriodEndsAt: new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000) },
      });
      const subRecord = await prisma.subscription.findFirst({ where: { externalSubscriptionId: subscriptionId } });
      if (subRecord) {
        await prisma.paymentEvent.create({
          data: { profileId: subRecord.profileId, subscriptionId: subRecord.id, billingProvider: "STRIPE", type: "CHARGE_FAILED", amountCents: invoice.amount_due, status: "failed" },
        });
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const sub = await prisma.subscription.findFirst({ where: { externalCustomerId: typeof charge.customer === "string" ? charge.customer : charge.customer?.id } });
      if (sub) {
        await prisma.paymentEvent.create({
          data: { profileId: sub.profileId, subscriptionId: sub.id, billingProvider: "STRIPE", type: "REFUND_ISSUED", externalTransactionId: charge.id, amountCents: charge.amount_refunded, status: "succeeded" },
        });
      }
      break;
    }
    default:
      break;
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAYMENT_FAILED" | "CANCELED" | "EXPIRED" | "INCOMPLETE" {
  switch (status) {
    case "trialing": return "TRIALING";
    case "active": return "ACTIVE";
    case "past_due": return "PAST_DUE";
    case "unpaid": return "PAYMENT_FAILED";
    case "canceled": return "CANCELED";
    case "incomplete_expired": return "EXPIRED";
    default: return "INCOMPLETE";
  }
}
