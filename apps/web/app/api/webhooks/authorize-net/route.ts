import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@foreclosuredata/database";

interface AuthorizeNetWebhookPayload {
  notificationId: string;
  eventType: string;
  payload: { id?: string; entityName?: string; [key: string]: unknown };
}

/**
 * Authorize.net webhook — HMAC-SHA512 signature verification (per
 * Authorize.net's webhook spec: header `X-ANET-Signature: sha512=<hex>`
 * over the raw body, keyed by AUTHORIZE_NET_SIGNATURE_KEY), with the same
 * idempotency guard as the Stripe route.
 *
 * Untested against a live sandbox — see the caveat in
 * lib/billing/authorizeNet.ts. Verify the exact event-type names and
 * payload shape against real webhook deliveries before depending on this.
 */
export async function POST(request: Request) {
  const signatureKey = process.env.AUTHORIZE_NET_SIGNATURE_KEY;
  if (!signatureKey) return NextResponse.json({ error: "Authorize.net not configured" }, { status: 503 });

  const signatureHeader = request.headers.get("x-anet-signature");
  const rawBody = await request.text();
  if (!signatureHeader) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const expected = createHmac("sha512", Buffer.from(signatureKey, "hex")).update(rawBody).digest("hex").toUpperCase();
  const provided = signatureHeader.replace(/^sha512=/i, "").toUpperCase();
  const valid =
    expected.length === provided.length && timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(rawBody) as AuthorizeNetWebhookPayload;

  const existing = await prisma.webhookEvent.findUnique({
    where: { billingProvider_externalEventId: { billingProvider: "AUTHORIZE_NET", externalEventId: event.notificationId } },
  });
  if (existing) return NextResponse.json({ ok: true, deduplicated: true });

  await prisma.webhookEvent.create({
    data: { billingProvider: "AUTHORIZE_NET", externalEventId: event.notificationId, eventType: event.eventType, payload: event as unknown as object },
  });

  await handleAuthorizeNetEvent(event);

  await prisma.webhookEvent.update({
    where: { billingProvider_externalEventId: { billingProvider: "AUTHORIZE_NET", externalEventId: event.notificationId } },
    data: { processedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

async function handleAuthorizeNetEvent(event: AuthorizeNetWebhookPayload) {
  const subscriptionId = event.payload.id;
  if (!subscriptionId) return;

  const subRecord = await prisma.subscription.findFirst({ where: { externalSubscriptionId: subscriptionId } });
  if (!subRecord) return;

  const graceDays = Number(process.env.PAYMENT_FAILURE_GRACE_PERIOD_DAYS ?? "7");

  switch (event.eventType) {
    case "net.authorize.customer.subscription.suspended":
    case "net.authorize.payment.authcapture.declined":
      await prisma.subscription.update({
        where: { id: subRecord.id },
        data: { status: "PAYMENT_FAILED", paymentGracePeriodEndsAt: new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000) },
      });
      await prisma.paymentEvent.create({
        data: { profileId: subRecord.profileId, subscriptionId: subRecord.id, billingProvider: "AUTHORIZE_NET", type: "CHARGE_FAILED", status: "failed" },
      });
      break;
    case "net.authorize.customer.subscription.terminated":
    case "net.authorize.customer.subscription.cancelled":
      await prisma.subscription.update({ where: { id: subRecord.id }, data: { status: "CANCELED", canceledAt: new Date() } });
      break;
    case "net.authorize.payment.authcapture.created":
      await prisma.subscription.update({ where: { id: subRecord.id }, data: { status: "ACTIVE", paymentGracePeriodEndsAt: null } });
      await prisma.paymentEvent.create({
        data: { profileId: subRecord.profileId, subscriptionId: subRecord.id, billingProvider: "AUTHORIZE_NET", type: "CHARGE_SUCCEEDED", status: "succeeded" },
      });
      break;
    default:
      break;
  }
}
