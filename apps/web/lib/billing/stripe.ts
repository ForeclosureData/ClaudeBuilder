import Stripe from "stripe";
import type {
  BillingProvider,
  BillingCustomer,
  CheckoutSession,
  BillingSubscription,
  BillingSubscriptionStatus,
  CreateCustomerInput,
  CreateCheckoutInput,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  UpdatePaymentMethodInput,
  RefundPaymentInput,
  BillingRefund,
  InternalPlanId,
} from "@foreclosuredata/types";
import { getPlanMapping } from "./planMappings";

function getClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured.");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

const STATUS_MAP: Record<Stripe.Subscription.Status, BillingSubscriptionStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "payment_failed",
  incomplete: "incomplete",
  incomplete_expired: "expired",
  paused: "canceled",
};

export class StripeBillingProvider implements BillingProvider {
  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    const customer = await getClient().customers.create({ email: input.email, name: input.fullName, metadata: { userId: input.userId } });
    return { externalCustomerId: customer.id, email: input.email };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const mapping = await getPlanMapping(input.internalPlanId, "STRIPE");
    const session = await getClient().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: mapping.externalRef, quantity: 1 }],
      subscription_data: input.trialDays ? { trial_period_days: input.trialDays } : undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.userId,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
    const mapping = await getPlanMapping(input.internalPlanId, "STRIPE");
    const subscription = await getClient().subscriptions.create({
      customer: input.externalCustomerId,
      items: [{ price: mapping.externalRef }],
      trial_period_days: input.trialDays,
    });
    return toBillingSubscription(subscription, input.internalPlanId);
  }

  async getSubscription(externalSubscriptionId: string): Promise<BillingSubscription> {
    const subscription = await getClient().subscriptions.retrieve(externalSubscriptionId);
    return toBillingSubscription(subscription, inferInternalPlanId(subscription));
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<BillingSubscription> {
    const client = getClient();
    const existing = await client.subscriptions.retrieve(input.externalSubscriptionId);
    let updateParams: Stripe.SubscriptionUpdateParams = {};
    if (input.newInternalPlanId) {
      const mapping = await getPlanMapping(input.newInternalPlanId, "STRIPE");
      const currentItemId = existing.items.data[0]?.id;
      updateParams.items = currentItemId ? [{ id: currentItemId, price: mapping.externalRef }] : [{ price: mapping.externalRef }];
    }
    if (input.cancelAtPeriodEnd !== undefined) {
      updateParams.cancel_at_period_end = input.cancelAtPeriodEnd;
    }
    const updated = await client.subscriptions.update(input.externalSubscriptionId, updateParams);
    return toBillingSubscription(updated, input.newInternalPlanId ?? inferInternalPlanId(updated));
  }

  async cancelSubscription(externalSubscriptionId: string, cancelAtPeriodEnd: boolean): Promise<BillingSubscription> {
    const client = getClient();
    const updated = cancelAtPeriodEnd
      ? await client.subscriptions.update(externalSubscriptionId, { cancel_at_period_end: true })
      : await client.subscriptions.cancel(externalSubscriptionId);
    return toBillingSubscription(updated, inferInternalPlanId(updated));
  }

  async updatePaymentMethod(input: UpdatePaymentMethodInput): Promise<void> {
    const client = getClient();
    await client.paymentMethods.attach(input.paymentMethodToken, { customer: input.externalCustomerId });
    await client.customers.update(input.externalCustomerId, {
      invoice_settings: { default_payment_method: input.paymentMethodToken },
    });
  }

  async refundPayment(input: RefundPaymentInput): Promise<BillingRefund> {
    const refund = await getClient().refunds.create({
      payment_intent: input.externalTransactionId,
      amount: input.amountCents,
      reason: input.reason as Stripe.RefundCreateParams.Reason | undefined,
    });
    return { externalRefundId: refund.id, amountCents: refund.amount, status: refund.status ?? "unknown" };
  }
}

function toBillingSubscription(sub: Stripe.Subscription, internalPlanId: InternalPlanId): BillingSubscription {
  return {
    externalSubscriptionId: sub.id,
    externalCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    internalPlanId,
    status: STATUS_MAP[sub.status] ?? "incomplete",
    currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  };
}

/** Stripe doesn't know our internal SKU names — the caller usually already has it; this is a best-effort fallback for webhook paths that only have the Stripe object. */
function inferInternalPlanId(sub: Stripe.Subscription): InternalPlanId {
  return (sub.metadata?.internalPlanId as InternalPlanId) ?? "county_monthly";
}
