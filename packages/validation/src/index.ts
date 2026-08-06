import { z } from "zod";

// ─── Property list filters (shared by web filter bar + mobile filters + API) ─

export const propertyFilterSchema = z.object({
  countySlug: z.string().optional(),
  saleDateFrom: z.string().datetime().optional(),
  saleDateTo: z.string().datetime().optional(),
  city: z.string().max(100).optional(),
  zipCode: z.string().max(10).optional(),
  propertyType: z.string().optional(),
  classification: z.enum(["RESIDENTIAL", "COMMERCIAL", "UNKNOWN"]).optional(),
  borrowerSearch: z.string().max(200).optional(),
  ownerSearch: z.string().max(200).optional(),
  lenderSearch: z.string().max(200).optional(),
  principalMinCents: z.number().int().nonnegative().optional(),
  principalMaxCents: z.number().int().nonnegative().optional(),
  appraisedValueMinCents: z.number().int().nonnegative().optional(),
  appraisedValueMaxCents: z.number().int().nonnegative().optional(),
  estimatedEquityMinCents: z.number().int().optional(),
  estimatedEquityMaxCents: z.number().int().optional(),
  minAddressConfidence: z.number().min(0).max(1).optional(),
  minExtractionConfidence: z.number().min(0).max(1).optional(),
  manualReviewStatus: z.enum(["NOT_NEEDED", "PENDING", "IN_REVIEW", "RESOLVED"]).optional(),
  savedOnly: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type PropertyFilter = z.infer<typeof propertyFilterSchema>;

// ─── Correction reports ────────────────────────────────────────────────────

export const correctionReportSchema = z.object({
  propertyId: z.string().uuid().optional(),
  foreclosureCaseId: z.string().uuid().optional(),
  fieldName: z.string().max(100).optional(),
  description: z.string().min(10).max(2000),
});
export type CorrectionReportInput = z.infer<typeof correctionReportSchema>;

// ─── Saved properties ──────────────────────────────────────────────────────

export const savePropertySchema = z.object({
  propertyId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});
export type SavePropertyInput = z.infer<typeof savePropertySchema>;

// ─── Notification preferences ──────────────────────────────────────────────

export const notificationEventTypeSchema = z.enum([
  "NEW_MATCHING_PROPERTY",
  "ADDRESS_RESOLVED",
  "SALE_DATE_CHANGED",
  "SALE_CANCELED",
  "SAVED_PROPERTY_REMINDER",
  "UPCOMING_AUCTION_REMINDER",
]);

export const notificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  webPushEnabled: z.boolean(),
  expoPushEnabled: z.boolean(),
  eventTypesEnabled: z.array(notificationEventTypeSchema),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

// ─── Entitlement (API response shape) ──────────────────────────────────────

export const entitlementSchema = z.object({
  plan: z.enum(["FREE", "COUNTY", "UNLIMITED"]),
  availableCounties: z.union([z.array(z.string()), z.literal("ALL")]),
  selectedCountySlug: z.string().nullable(),
  maxSavedProperties: z.number().int(),
  canExportCsv: z.boolean(),
  monthlyCsvExportLimit: z.number().int(),
  csvExportsUsedThisMonth: z.number().int(),
  canViewDocuments: z.boolean(),
  canReceiveAlerts: z.boolean(),
  canViewRecordHistory: z.boolean(),
  trialEndsAt: z.string().nullable(),
});
export type EntitlementResponse = z.infer<typeof entitlementSchema>;

// ─── Sourced-field envelope (used across many API response fields) ────────

export const sourcedFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: z.union([valueSchema, z.null()]),
    sourceType: z.enum([
      "foreclosure_notice",
      "county_clerk",
      "appraisal_district",
      "geocoding_service",
      "third_party_data",
      "calculated",
      "manual",
    ]),
    sourceUrl: z.string().url().optional(),
    confidence: z.number().min(0).max(1).optional(),
    verifiedAt: z.string().datetime().optional(),
    methodology: z.string().optional(),
    explicitlyStated: z.boolean().optional(),
    supportingText: z.string().optional(),
    pageNumber: z.number().int().optional(),
  });

// ─── Property list/detail API response shapes ──────────────────────────────

export const propertySummarySchema = z.object({
  id: z.string().uuid(),
  countySlug: z.string(),
  propertyStreetAddress: z.string().nullable(),
  city: z.string().nullable(),
  zipCode: z.string().nullable(),
  propertyType: z.string(),
  classification: z.string(),
  saleDate: z.string().datetime().nullable(),
  saleStatus: z.string(),
  appraisedValueCents: z.number().int().nullable(),
  addressResolutionConfidence: z.number().nullable(),
  extractionConfidence: z.number().nullable(),
  isSaved: z.boolean().optional(),
});
export type PropertySummary = z.infer<typeof propertySummarySchema>;

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalCount: z.number().int(),
  });

// ─── Property detail API response shape ────────────────────────────────────

const sourcedValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  sourceType: z.enum([
    "foreclosure_notice",
    "county_clerk",
    "appraisal_district",
    "geocoding_service",
    "third_party_data",
    "calculated",
    "manual",
  ]).nullable(),
  confidence: z.number().nullable(),
  explicitlyStated: z.boolean().optional(),
  supportingText: z.string().nullable().optional(),
  pageNumber: z.number().nullable().optional(),
});
export type SourcedValue = z.infer<typeof sourcedValueSchema>;

export const propertyDetailSchema = z.object({
  id: z.string().uuid(),
  countySlug: z.string(),
  countyName: z.string(),
  propertyStreetAddress: z.string().nullable(),
  city: z.string().nullable(),
  zipCode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  propertyType: z.string(),
  classification: z.string(),
  appraisedValueCents: z.number().nullable(),
  addressResolutionMethod: z.string(),
  addressResolutionConfidence: z.number().nullable(),
  addressResolutionExplanation: z.string().nullable(),
  isSaved: z.boolean().optional(),
  lastVerifiedAt: z.string().nullable(),
  summaryText: z.string().nullable(),
  saleDate: z.string().nullable(),
  saleTime: z.string().nullable(),
  saleLocation: z.string().nullable(),
  saleStatus: z.string(),
  borrowerName: sourcedValueSchema,
  lenderName: sourcedValueSchema,
  originalPrincipalAmountCents: sourcedValueSchema,
  currentPrincipalBalanceCents: sourcedValueSchema,
  estimatedRemainingBalanceCents: z
    .object({ value: z.number().nullable(), methodology: z.string().nullable(), confidence: z.number().nullable(), disclaimer: z.string().nullable() })
    .nullable(),
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      filename: z.string(),
      documentType: z.string(),
      filingDate: z.string().nullable(),
      manualReviewStatus: z.string(),
      documentUrl: z.string(),
      canView: z.boolean(),
    }),
  ),
  canViewDocuments: z.boolean(),
});
export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

// ─── County availability ───────────────────────────────────────────────────

export const countyAvailabilitySchema = z.object({
  slug: z.string(),
  name: z.string(),
  state: z.string(),
  isActive: z.boolean(),
});
export type CountyAvailability = z.infer<typeof countyAvailabilitySchema>;
