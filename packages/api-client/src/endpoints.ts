import { z } from "zod";
import {
  propertySummarySchema,
  propertyDetailSchema,
  paginatedResponseSchema,
  entitlementSchema,
  countyAvailabilitySchema,
  notificationPreferencesSchema,
  type PropertyFilter,
  type CorrectionReportInput,
  type NotificationPreferencesInput,
} from "@foreclosuredata/validation";
import type { ApiClient } from "./client";

const okSchema = z.object({ ok: z.literal(true) });

export function createForeclosureApi(client: ApiClient) {
  return {
    listForeclosures: (filters: Partial<PropertyFilter>) => {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(filters)) {
        if (val !== undefined && val !== null) params.set(key, String(val));
      }
      return client.request(`/api/properties?${params.toString()}`, paginatedResponseSchema(propertySummarySchema));
    },

    getForeclosure: (propertyId: string) =>
      client.request(`/api/properties/${propertyId}`, propertyDetailSchema),

    searchProperties: (query: string) =>
      client.request(`/api/properties?borrowerSearch=${encodeURIComponent(query)}`, paginatedResponseSchema(propertySummarySchema)),

    saveProperty: (propertyId: string, notes?: string) =>
      client.request("/api/saved-properties", okSchema, {
        method: "POST",
        body: JSON.stringify({ propertyId, notes }),
      }),

    unsaveProperty: (propertyId: string) =>
      client.request(`/api/saved-properties/${propertyId}`, okSchema, { method: "DELETE" }),

    getCountyAvailability: () =>
      client.request("/api/counties", z.array(countyAvailabilitySchema)),

    reportCorrection: (payload: CorrectionReportInput) =>
      client.request("/api/corrections", okSchema, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getEntitlement: () => client.request("/api/entitlement", entitlementSchema),

    getNotificationPreferences: () =>
      client.request("/api/notification-preferences", notificationPreferencesSchema),

    updateNotificationPreferences: (prefs: NotificationPreferencesInput) =>
      client.request("/api/notification-preferences", notificationPreferencesSchema, {
        method: "PUT",
        body: JSON.stringify(prefs),
      }),
  };
}

export type ForeclosureApi = ReturnType<typeof createForeclosureApi>;
