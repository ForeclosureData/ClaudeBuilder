// Cross-cutting types shared by web, mobile, and worker. No runtime
// dependencies here — this package must stay importable from React Native.

export type FieldSourceType =
  | "foreclosure_notice"
  | "county_clerk"
  | "appraisal_district"
  | "geocoding_service"
  | "third_party_data"
  | "calculated"
  | "manual";

export interface SourcedField<T> {
  value: T | null;
  sourceType: FieldSourceType;
  sourceUrl?: string;
  confidence?: number;
  verifiedAt?: string;
  methodology?: string;
  explicitlyStated?: boolean;
  supportingText?: string;
  pageNumber?: number;
}

export interface ExtractedValue<T> {
  value: T | null;
  explicitlyStated: boolean;
  confidence: number;
  supportingText: string | null;
  pageNumber: number | null;
}

export interface ExtractedForeclosureNotice {
  borrowerNames: ExtractedValue<string[]>;
  grantorNames: ExtractedValue<string[]>;
  lenderName: ExtractedValue<string>;
  mortgageServicer: ExtractedValue<string>;
  originalPrincipalAmount: ExtractedValue<number>;
  currentPrincipalBalance: ExtractedValue<number>;
  deedOfTrustDate: ExtractedValue<string>;
  instrumentNumber: ExtractedValue<string>;
  recordingDate: ExtractedValue<string>;
  propertyAddress: ExtractedValue<string>;
  legalDescription: ExtractedValue<string>;
  propertyId: ExtractedValue<string>;
  saleDate: ExtractedValue<string>;
  saleTime: ExtractedValue<string>;
  saleLocation: ExtractedValue<string>;
  substituteTrustee: ExtractedValue<string[]>;
}

// ─── Billing / entitlements ─────────────────────────────────────────────

export type PlanKey = "FREE" | "COUNTY" | "UNLIMITED";

// ─── Billing provider abstraction ────────────────────────────────────────
//
// Implemented today by MockBillingProvider (default/local/tests),
// StripeBillingProvider, and AuthorizeNetBillingProvider (see
// apps/web/lib/billing). Anything that talks to a payment processor must
// go through this interface — never call a provider SDK directly from a
// route handler or component. The entitlement system (resolveEntitlement)
// never imports this interface or branches on which provider is active.

export type BillingProviderKind = "STRIPE" | "AUTHORIZE_NET" | "MOCK";
export type BillingInterval = "MONTHLY" | "ANNUAL";

/** Internal, provider-agnostic plan SKUs — never a Stripe price ID or an Authorize.net plan ref. */
export type InternalPlanId = "county_monthly" | "county_annual" | "texas_monthly" | "texas_annual";

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "payment_failed"
  | "canceled"
  | "expired"
  | "promotional"
  | "incomplete";

export interface BillingCustomer {
  externalCustomerId: string;
  email: string;
}

export interface BillingSubscription {
  externalSubscriptionId: string;
  externalCustomerId: string;
  internalPlanId: InternalPlanId;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
}

export interface CheckoutSession {
  /** Where to send the browser — a Stripe Checkout URL, or a page hosting the Authorize.net Accept Hosted iframe/token. */
  url: string;
  /** Present for Accept Hosted flows; the client-side form uses this token, never a raw card number. */
  hostedFormToken?: string;
}

export interface BillingRefund {
  externalRefundId: string;
  amountCents: number;
  status: string;
}

export interface CreateCustomerInput {
  userId: string;
  email: string;
  fullName?: string;
}

export interface CreateCheckoutInput {
  userId: string;
  internalPlanId: InternalPlanId;
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateSubscriptionInput {
  externalCustomerId: string;
  internalPlanId: InternalPlanId;
  trialDays?: number;
  paymentMethodToken?: string;
}

export interface UpdateSubscriptionInput {
  externalSubscriptionId: string;
  newInternalPlanId?: InternalPlanId;
  cancelAtPeriodEnd?: boolean;
}

export interface UpdatePaymentMethodInput {
  externalCustomerId: string;
  paymentMethodToken: string;
}

export interface RefundPaymentInput {
  externalTransactionId: string;
  amountCents?: number;
  reason?: string;
}

export interface BillingProvider {
  createCustomer(input: CreateCustomerInput): Promise<BillingCustomer>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription>;
  getSubscription(externalSubscriptionId: string): Promise<BillingSubscription>;
  updateSubscription(input: UpdateSubscriptionInput): Promise<BillingSubscription>;
  cancelSubscription(externalSubscriptionId: string, cancelAtPeriodEnd: boolean): Promise<BillingSubscription>;
  updatePaymentMethod(input: UpdatePaymentMethodInput): Promise<void>;
  refundPayment(input: RefundPaymentInput): Promise<BillingRefund>;
}

export interface Entitlement {
  plan: PlanKey;
  /** County slugs this account has full access to, or "ALL" for the Texas Unlimited plan. Empty array on Free. */
  availableCounties: string[] | "ALL";
  /** Convenience for the COUNTY plan's single unlocked county; null otherwise. */
  selectedCountySlug: string | null;
  maxSavedProperties: number;
  canExportCsv: boolean;
  monthlyCsvExportLimit: number;
  csvExportsUsedThisMonth: number;
  canViewDocuments: boolean;
  canReceiveAlerts: boolean;
  canViewRecordHistory: boolean;
  trialEndsAt: string | null;
}

/** True if the entitlement grants full (non-preview) access to a given county. */
export function hasFullAccessToCounty(entitlement: Entitlement, countySlug: string): boolean {
  return entitlement.availableCounties === "ALL" || entitlement.availableCounties.includes(countySlug);
}

// ─── Notifications ───────────────────────────────────────────────────────

export type NotificationEventType =
  | "NEW_MATCHING_PROPERTY"
  | "ADDRESS_RESOLVED"
  | "SALE_DATE_CHANGED"
  | "SALE_CANCELED"
  | "SAVED_PROPERTY_REMINDER"
  | "UPCOMING_AUCTION_REMINDER";

export type NotificationChannel = "EMAIL" | "WEB_PUSH" | "EXPO_PUSH";

export interface NotificationPreferences {
  emailEnabled: boolean;
  webPushEnabled: boolean;
  expoPushEnabled: boolean;
  eventTypesEnabled: NotificationEventType[];
}

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  createdAt: string;
  readAt: string | null;
  payload: Record<string, unknown> | null;
}

/** One implementation per channel; the event model never changes when a delivery adapter is swapped. */
export interface NotificationDelivery {
  channel: NotificationChannel;
  send(userId: string, event: NotificationEvent): Promise<void>;
}

// ─── Address resolution ─────────────────────────────────────────────────

export type AddressResolutionMethod =
  | "EXPLICIT_STATED"
  | "COMMONLY_KNOWN_AS_PHRASE"
  | "LEGAL_DESCRIPTION_MATCH"
  | "PROPERTY_ID_MATCH"
  | "OWNER_MAILING_ADDRESS_MATCH"
  | "GEOCODING"
  | "MANUAL"
  | "UNRESOLVED";

export interface AddressResolutionResult {
  addressResolutionMethod: AddressResolutionMethod;
  addressResolutionConfidence: number;
  addressResolutionExplanation: string;
  resolvedAddress: string | null;
  propertyId: string | null;
}

// ─── Balance estimation ─────────────────────────────────────────────────

export interface BalanceEstimateAssumptions {
  assumedAnnualInterestRatePct: number;
  assumedTermYears: number;
  calculationDate: string;
}

export interface BalanceEstimateResult {
  estimatedRemainingBalanceCents: number;
  methodology: "amortized_estimate_v1";
  confidence: number;
  assumptions: BalanceEstimateAssumptions;
  disclaimer: string;
}
