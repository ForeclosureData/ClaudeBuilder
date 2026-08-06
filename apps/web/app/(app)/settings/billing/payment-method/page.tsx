import { Card, CardContent } from "@/components/ui/card";

/**
 * Placeholder for the Authorize.net Accept Hosted payment-method-update
 * flow. Real implementation embeds Authorize.net's hosted iframe using a
 * token from getHostedPaymentPageRequest (see lib/billing/authorizeNet.ts)
 * — this server never renders its own card-number input or receives raw
 * card data. Wiring the actual iframe requires a live sandbox to verify
 * the token/response shape, so this page currently explains the flow
 * rather than embedding an untested iframe.
 */
export default function UpdatePaymentMethodPage() {
  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Update payment method</h1>
      <Card>
        <CardContent className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
          <p>
            Payment methods for Authorize.net subscriptions are updated through Authorize.net's
            hosted form — your card details never pass through ForeclosureData's servers.
          </p>
          <p>This flow is pending a live Authorize.net sandbox to verify against; contact support to update your payment method in the meantime.</p>
        </CardContent>
      </Card>
    </div>
  );
}
