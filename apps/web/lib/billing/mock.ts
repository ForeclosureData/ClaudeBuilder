import type {
  BillingProvider,
  BillingCustomer,
  CheckoutSession,
  BillingSubscription,
  CreateCustomerInput,
  CreateCheckoutInput,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  UpdatePaymentMethodInput,
  RefundPaymentInput,
  BillingRefund,
} from "@foreclosuredata/types";

/**
 * Fully functional local/test provider — no network calls, no real money.
 * `createCheckoutSession` returns a URL to an internal confirm endpoint
 * (`/api/billing/mock-confirm`) that immediately "activates" the
 * subscription, so the whole trial → active flow is exercisable in local
 * dev and automated tests without a payment gateway or webhook delivery.
 */
export class MockBillingProvider implements BillingProvider {
  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    return { externalCustomerId: `mock_cust_${input.userId}`, email: input.email };
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const params = new URLSearchParams({
      userId: input.userId,
      internalPlanId: input.internalPlanId,
      trialDays: String(input.trialDays ?? 0),
      redirect: input.successUrl,
    });
    return { url: `/api/billing/mock-confirm?${params.toString()}` };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
    const now = new Date();
    const trialEnd = input.trialDays ? new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000) : null;
    return {
      externalSubscriptionId: `mock_sub_${input.externalCustomerId}_${Date.now()}`,
      externalCustomerId: input.externalCustomerId,
      internalPlanId: input.internalPlanId,
      status: trialEnd ? "trialing" : "active",
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: trialEnd?.toISOString() ?? null,
    };
  }

  async getSubscription(externalSubscriptionId: string): Promise<BillingSubscription> {
    return {
      externalSubscriptionId,
      externalCustomerId: "mock_customer",
      internalPlanId: "county_monthly",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    };
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<BillingSubscription> {
    const current = await this.getSubscription(input.externalSubscriptionId);
    return {
      ...current,
      internalPlanId: input.newInternalPlanId ?? current.internalPlanId,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? current.cancelAtPeriodEnd,
    };
  }

  async cancelSubscription(externalSubscriptionId: string, cancelAtPeriodEnd: boolean): Promise<BillingSubscription> {
    const current = await this.getSubscription(externalSubscriptionId);
    return { ...current, status: cancelAtPeriodEnd ? current.status : "canceled", cancelAtPeriodEnd };
  }

  async updatePaymentMethod(_input: UpdatePaymentMethodInput): Promise<void> {
    // No-op — nothing to update on a mock provider.
  }

  async refundPayment(input: RefundPaymentInput): Promise<BillingRefund> {
    return { externalRefundId: `mock_refund_${input.externalTransactionId}`, amountCents: input.amountCents ?? 0, status: "succeeded" };
  }
}
