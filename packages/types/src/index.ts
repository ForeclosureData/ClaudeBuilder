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
  | "GEOGRAPHIC_ID_MATCH"
  | "OWNER_MAILING_ADDRESS_MATCH"
  | "MULTI_FIELD_MATCH"
  | "GEOCODING"
  | "CACHED_MATCH_REUSE"
  | "MANUAL"
  | "UNRESOLVED";

export interface AddressResolutionResult {
  addressResolutionMethod: AddressResolutionMethod;
  addressResolutionConfidence: number;
  addressResolutionExplanation: string;
  resolvedAddress: string | null;
  propertyId: string | null;
}

// ─── County appraisal-district resolution (candidates + scoring) ────────

export interface AppraisalPropertySearchQuery {
  ownerNames?: string[];
  streetAddress?: string;
  city?: string;
  postalCode?: string;
  parcelId?: string;
  geographicId?: string;
  legalDescription?: string;
  subdivision?: string;
  lot?: string;
  block?: string;
  acreage?: number;
  instrumentNumber?: string;
}

export interface AppraisalPropertyCandidate {
  sourcePropertyId: string;
  sourceUrl?: string;
  ownerName: string | null;
  situsAddress: string | null;
  city: string | null;
  zipCode: string | null;
  parcelId: string | null;
  geographicId: string | null;
  legalDescription: string | null;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  classification: "RESIDENTIAL" | "COMMERCIAL" | "UNKNOWN";
  landValueCents: number | null;
  improvementValueCents: number | null;
  appraisedValueCents: number | null;
  assessedValueCents: number | null;
  marketValueCents: number | null;
  homestead: boolean | null;
  taxYear: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** Full detail fetch — same shape as a candidate today; kept distinct in the interface since a real adapter's "details" call is typically a different, richer request than "search." */
export type AppraisalPropertyRecord = AppraisalPropertyCandidate;

export interface AppraisalSourceAccessMetadata {
  officialApiAvailable: boolean;
  bulkDataAvailable: boolean;
  requiresManualAccess: boolean;
  notes: string;
}

/**
 * Caps how many real network requests an adapter may spend across a whole
 * resolution attempt (all search strategies, and -- for adapters that
 * paginate internally -- every page fetch within each strategy). Mutated
 * in place by the adapter as requests are spent; a fixture/mock adapter
 * can safely ignore it since it makes no real requests.
 */
export interface AppraisalRequestBudget {
  remaining: number;
}

/**
 * Provider-neutral interface for a county appraisal district data source.
 * Implementations must only use access methods the source's own terms
 * permit (official API, approved bulk-data file, licensed vendor feed,
 * public-information-request import, or administrator upload/manual
 * entry) — never CAPTCHA bypass, auth bypass, or automation prohibited by
 * the source's terms. See HidalgoCountyAppraisalAdapter for an adapter
 * that is intentionally a stub until its access method is documented.
 */
export interface CountyAppraisalAdapter {
  countyCode: string;
  countyName: string;
  stateCode: string;
  sourceName: string;
  sourceUrl: string;

  capabilities: {
    searchByOwnerName: boolean;
    searchByAddress: boolean;
    searchByParcelId: boolean;
    searchByLegalDescription: boolean;
    searchBySubdivision: boolean;
    searchByLotBlock: boolean;
    searchByMap: boolean;
    bulkDataAvailable: boolean;
    officialApiAvailable: boolean;
  };

  searchProperties(query: AppraisalPropertySearchQuery, budget?: AppraisalRequestBudget): Promise<AppraisalPropertyCandidate[]>;
  getPropertyDetails(sourcePropertyId: string): Promise<AppraisalPropertyRecord>;
  getAccessMetadata(): Promise<AppraisalSourceAccessMetadata>;
}

export type PropertyResolutionMethod =
  | "explicit_address"
  | "parcel_id_match"
  | "geographic_id_match"
  | "exact_legal_description"
  | "subdivision_lot_block"
  | "multi_field_match"
  | "manual"
  | "unresolved";

export interface PropertyResolutionResult {
  selectedCandidateId: string | null;
  confidence: number;
  resolutionMethod: PropertyResolutionMethod;
  explanation: string;
  matchedFields: string[];
  conflictingFields: string[];
  candidateCount: number;
  requiresManualReview: boolean;
}

// ─── Property valuation providers ─────────────────────────────────────

export type ValuationType = "zestimate" | "county_appraised_value" | "county_market_value" | "third_party_avm" | "internal_estimate";

export interface PropertyValuationLookupInput {
  propertyId: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  county?: string;
  parcelId?: string;
  latitude?: number;
  longitude?: number;
}

export interface PropertyValuationResult {
  providerKey: string;
  providerPropertyId?: string;
  valuationType: ValuationType;

  value: number;
  currency: "USD";
  lowRange?: number;
  highRange?: number;
  confidence?: number;
  effectiveDate?: string;
  retrievedAt: string;
  sourceUrl?: string;
  attributionText?: string;
  methodology?: string;
  licenseAllowsDisplay: boolean;
  licenseAllowsStorage: boolean;
  expiresAt?: string;
}

/**
 * Provider-neutral interface for an automated-valuation-model (AVM) or
 * official-record value source. "AVM" is the generic internal term —
 * "Zestimate" is a Zillow trademark and must only be used for a value
 * that actually came from ZillowAuthorizedProvider with a live,
 * authorized connection (see apps/web/lib/valuation/zillow.ts).
 */
export interface PropertyValuationProvider {
  providerKey: string;
  displayName: string;

  supportsAddressLookup: boolean;
  supportsParcelLookup: boolean;
  supportsCommercialUse: boolean;
  supportsRedistribution: boolean;

  getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null>;
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
