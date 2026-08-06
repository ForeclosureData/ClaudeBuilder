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
} from "@foreclosuredata/types";
import { getPlanMapping, billingIntervalForInternalPlanId } from "./planMappings";

/**
 * Authorize.net billing provider. Uses Accept Hosted for checkout/payment
 * capture (the ForeclosureData server never receives, stores, logs, or
 * transmits a raw card number — only Authorize.net's hosted form and an
 * opaque payment descriptor ever touch card data) and Automated Recurring
 * Billing (ARB) for the actual subscription.
 *
 * IMPORTANT: this has not been exercised against a live Authorize.net
 * sandbox (no sandbox credentials exist in this environment). The request
 * shapes below follow Authorize.net's documented JSON API; verify each
 * response shape against the real sandbox before relying on this in
 * production, and treat this as a strong starting point, not a
 * battle-tested integration.
 */

interface MerchantAuth {
  name: string;
  transactionKey: string;
}

function getAuth(): MerchantAuth {
  const name = process.env.AUTHORIZE_NET_API_LOGIN_ID;
  const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
  if (!name || !transactionKey) throw new Error("AUTHORIZE_NET_API_LOGIN_ID / AUTHORIZE_NET_TRANSACTION_KEY not configured.");
  return { name, transactionKey };
}

function getApiBaseUrl(): string {
  const env = process.env.AUTHORIZE_NET_ENVIRONMENT ?? "sandbox";
  return env === "production" ? "https://api.authorize.net/xml/v1/request.php" : "https://apitest.authorize.net/xml/v1/request.php";
}

async function callAuthorizeNet<T>(requestKey: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(getApiBaseUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [requestKey]: { merchantAuthentication: getAuth(), ...body } }),
  });
  const json = await response.json();
  const resultCode = json?.messages?.resultCode;
  if (resultCode !== "Ok") {
    const message = json?.messages?.message?.[0]?.text ?? "Authorize.net request failed";
    throw new Error(`Authorize.net error: ${message}`);
  }
  return json as T;
}

const ARB_STATUS_MAP: Record<string, BillingSubscriptionStatus> = {
  active: "active",
  expired: "expired",
  suspended: "past_due",
  canceled: "canceled",
  terminated: "canceled",
};

export class AuthorizeNetBillingProvider implements BillingProvider {
  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    const result = await callAuthorizeNet<{ customerProfileId: string }>("createCustomerProfileRequest", {
      profile: { merchantCustomerId: input.userId, email: input.email, description: input.fullName ?? "" },
    });
    return { externalCustomerId: result.customerProfileId, email: input.email };
  }

  /**
   * Returns a hosted-form token (via getHostedPaymentPageRequest) for
   * Accept Hosted. The `url` is our own page (see
   * app/(app)/settings/billing/checkout/page.tsx) that embeds Authorize.net's
   * hosted iframe using this token — we never render our own card form.
   */
  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const mapping = await getPlanMapping(input.internalPlanId, "AUTHORIZE_NET");
    const result = await callAuthorizeNet<{ token: string }>("getHostedPaymentPageRequest", {
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: (mapping.priceCents / 100).toFixed(2),
      },
      hostedPaymentSettings: {
        setting: [
          { settingName: "hostedPaymentReturnOptions", settingValue: JSON.stringify({ showReceipt: false, url: input.successUrl, cancelUrl: input.cancelUrl }) },
          { settingName: "hostedPaymentButtonOptions", settingValue: JSON.stringify({ text: "Subscribe" }) },
        ],
      },
    });
    return { url: `/settings/billing/checkout?token=${result.token}&plan=${input.internalPlanId}`, hostedFormToken: result.token };
  }

  /**
   * Creates the ARB subscription against a customer/payment profile
   * established by the Accept Hosted flow (input.paymentMethodToken here
   * is Authorize.net's opaque payment profile reference, not a card number).
   */
  async createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
    const mapping = await getPlanMapping(input.internalPlanId, "AUTHORIZE_NET");
    const interval = billingIntervalForInternalPlanId(input.internalPlanId);
    const result = await callAuthorizeNet<{ subscriptionId: string }>("ARBCreateSubscriptionRequest", {
      subscription: {
        name: mapping.externalRef,
        paymentSchedule: {
          interval: interval === "ANNUAL" ? { length: 1, unit: "years" } : { length: 1, unit: "months" },
          startDate: new Date(Date.now() + (input.trialDays ?? 0) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          totalOccurrences: 9999,
          trialOccurrences: input.trialDays ? 1 : 0,
        },
        amount: (mapping.priceCents / 100).toFixed(2),
        trialAmount: "0.00",
        profile: { customerProfileId: input.externalCustomerId, customerPaymentProfileId: input.paymentMethodToken },
      },
    });
    return {
      externalSubscriptionId: result.subscriptionId,
      externalCustomerId: input.externalCustomerId,
      internalPlanId: input.internalPlanId,
      status: input.trialDays ? "trialing" : "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: input.trialDays ? new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000).toISOString() : null,
    };
  }

  async getSubscription(externalSubscriptionId: string): Promise<BillingSubscription> {
    const result = await callAuthorizeNet<{
      subscription: { status: string; amount: string; profile: { customerProfileId: string } };
    }>("ARBGetSubscriptionStatusRequest", { subscriptionId: externalSubscriptionId });
    return {
      externalSubscriptionId,
      externalCustomerId: result.subscription.profile.customerProfileId,
      internalPlanId: "county_monthly", // Authorize.net has no native concept of our SKU — the caller should already know this from its own records.
      status: ARB_STATUS_MAP[result.subscription.status.toLowerCase()] ?? "incomplete",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    };
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<BillingSubscription> {
    if (input.newInternalPlanId) {
      const mapping = await getPlanMapping(input.newInternalPlanId, "AUTHORIZE_NET");
      await callAuthorizeNet("ARBUpdateSubscriptionRequest", {
        subscriptionId: input.externalSubscriptionId,
        subscription: { amount: (mapping.priceCents / 100).toFixed(2), name: mapping.externalRef },
      });
    }
    if (input.cancelAtPeriodEnd) {
      // Authorize.net ARB has no native "cancel at period end" — the
      // application layer must track this and call cancelSubscription
      // itself when the current period actually ends.
    }
    return this.getSubscription(input.externalSubscriptionId);
  }

  async cancelSubscription(externalSubscriptionId: string, cancelAtPeriodEnd: boolean): Promise<BillingSubscription> {
    if (!cancelAtPeriodEnd) {
      await callAuthorizeNet("ARBCancelSubscriptionRequest", { subscriptionId: externalSubscriptionId });
    }
    const current = await this.getSubscription(externalSubscriptionId).catch(() => null);
    return {
      externalSubscriptionId,
      externalCustomerId: current?.externalCustomerId ?? "",
      internalPlanId: current?.internalPlanId ?? "county_monthly",
      status: cancelAtPeriodEnd ? (current?.status ?? "active") : "canceled",
      currentPeriodEnd: current?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd,
      trialEndsAt: null,
    };
  }

  async updatePaymentMethod(input: UpdatePaymentMethodInput): Promise<void> {
    await callAuthorizeNet("updateCustomerPaymentProfileRequest", {
      customerProfileId: input.externalCustomerId,
      paymentProfile: { customerPaymentProfileId: input.paymentMethodToken },
    });
  }

  async refundPayment(input: RefundPaymentInput): Promise<BillingRefund> {
    const result = await callAuthorizeNet<{ transactionResponse: { transId: string; responseCode: string } }>("createTransactionRequest", {
      transactionRequest: {
        transactionType: "refundTransaction",
        amount: input.amountCents ? (input.amountCents / 100).toFixed(2) : undefined,
        refTransId: input.externalTransactionId,
      },
    });
    return {
      externalRefundId: result.transactionResponse.transId,
      amountCents: input.amountCents ?? 0,
      status: result.transactionResponse.responseCode === "1" ? "succeeded" : "failed",
    };
  }
}
