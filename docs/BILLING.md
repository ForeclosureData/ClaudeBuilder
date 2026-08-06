# Billing

## Provider abstraction

`packages/types` defines `BillingProvider` (create/get/update/cancel
subscription, create customer, update payment method, refund). Three
implementations live in `apps/web/lib/billing`:

- **MockBillingProvider** — default, no network calls, used for local dev
  and tests. `createCheckoutSession` returns a URL to an internal
  `/api/billing/mock-confirm` endpoint that immediately activates the
  subscription, so the full trial → active flow is exercisable without a
  real gateway.
- **StripeBillingProvider** — Stripe Checkout (subscription mode) +
  Subscriptions API + Billing Portal. Kept available as a fallback.
- **AuthorizeNetBillingProvider** — Accept Hosted for checkout/payment
  capture and Automated Recurring Billing (ARB) for the subscription
  itself, against Merchant1 Solutions' own Authorize.net merchant
  account. **Not yet exercised against a live sandbox** — see the caveat
  at the top of `lib/billing/authorizeNet.ts` before depending on it.

Selected once via `BILLING_PROVIDER` (`authorize_net` | `stripe` | `mock`,
defaults to `mock`) in `lib/billing/index.ts::getBillingProvider()`.
Nothing outside `lib/billing` and the webhook routes may import a
provider SDK (`stripe`, or Authorize.net's API) directly.

**The ForeclosureData server never collects, stores, logs, or transmits a
raw card number.** Both providers use hosted checkout (Stripe Checkout /
Authorize.net Accept Hosted) or tokenized payment methods.

## Entitlement independence

`packages/auth/src/entitlement.ts::resolveEntitlement()` reads only
`Subscription.plan` / `.status` / `.selectedCounty` — it never imports
`BillingProvider` or branches on `billingProvider`. Swapping the active
payment processor never touches entitlement logic.

## Plan mapping

Internal plan SKUs (`county_monthly`, `county_annual`, `texas_monthly`,
`texas_annual`) are never hardcoded against a specific Stripe price ID or
Authorize.net ARB plan reference in application code. `PlanMapping`
(`internalPlanId` × `billingProvider` → `externalRef`, `billingInterval`,
`priceCents`, `currency`, `isActive`) is the lookup table — see
`lib/billing/planMappings.ts::getPlanMapping()`. Seed data populates only
`MOCK` rows; add `STRIPE`/`AUTHORIZE_NET` rows once those accounts exist.

## Trial handling

Every checkout is initiated with a 7-day trial
(`app/api/billing/checkout/route.ts`). The pricing page discloses the
trial-ending date, billing interval, and amount before checkout starts.
**Access is granted only after the backend confirms the subscription is
`trialing`/`active`/`promotional`** — via the mock-confirm endpoint or a
provider webhook — never merely because the browser redirected to a
success URL.

## Failed payments & grace period

A failed payment sets `Subscription.status = PAYMENT_FAILED` and
`paymentGracePeriodEndsAt = now + PAYMENT_FAILURE_GRACE_PERIOD_DAYS`
(default 7). `resolveEntitlement()` keeps the subscriber's current plan
active until that date passes, then falls back to Free automatically —
no code deletes `SavedProperty` or history rows when this happens.

## Founding-member promotion

`Subscription.isFoundingMember` / `foundingMemberApprovedById` /
`foundingMemberApprovedAt` / `promotionalMonthsGranted` are set
explicitly per subscriber — never assumed for "everyone who signed up
early." `FOUNDING_MEMBER_SLOTS` / `FOUNDING_MEMBER_FREE_MONTHS` env vars
make the program's size/length configurable. No zero-dollar transactions
are created at the payment provider to represent the promotion — it's
purely a `Subscription.status = PROMOTIONAL` / extended `currentPeriodEnd`
in our own database.

## Webhooks

`app/api/webhooks/stripe/route.ts` and
`app/api/webhooks/authorize-net/route.ts` verify the provider's signature
before touching the database, then check `WebhookEvent`'s unique
`(billingProvider, externalEventId)` constraint — a redelivered event is
detected and skipped, never double-processed.

## Payment history

`PaymentEvent` rows (charge succeeded/failed, refund issued, subscription
lifecycle) back the account billing page's history and are written by
both the webhook handlers and the mock-confirm endpoint.
