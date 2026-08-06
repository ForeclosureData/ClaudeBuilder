// Design tokens shared by apps/web (Tailwind) and apps/mobile (StyleSheet /
// NativeWind). We do not share visual components between the two — only
// these primitive values, so both platforms render the same brand and the
// same vocabulary for status/confidence/estimate labeling.

export const colors = {
  brand: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a5f",
  },
  neutral: {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
  },
  success: { 50: "#f0fdf4", 500: "#22c55e", 700: "#15803d" },
  warning: { 50: "#fffbeb", 500: "#f59e0b", 700: "#b45309" },
  danger: { 50: "#fef2f2", 500: "#ef4444", 700: "#b91c1c" },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 9999,
} as const;

export const typography = {
  fontFamily: {
    sans: "Inter, system-ui, -apple-system, sans-serif",
  },
  size: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

// ─── Shared product vocabulary (must read identically on web and mobile) ──

export const saleStatusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  POSTPONED: "Postponed",
  CANCELED: "Canceled",
  SOLD: "Sold",
  UNKNOWN: "Status unknown",
};

export const confidenceLabel = (confidence: number | null | undefined): string => {
  if (confidence === null || confidence === undefined) return "Unknown confidence";
  if (confidence >= 0.85) return "High confidence";
  if (confidence >= 0.6) return "Medium confidence";
  return "Low confidence — verify independently";
};

export const confidenceTone = (confidence: number | null | undefined): "success" | "warning" | "danger" => {
  if (confidence === null || confidence === undefined) return "danger";
  if (confidence >= 0.85) return "success";
  if (confidence >= 0.6) return "warning";
  return "danger";
};

export const estimatedFieldLabel = "Estimated — not a verified figure";

export const addressResolutionMethodLabels: Record<string, string> = {
  EXPLICIT_STATED: "Stated explicitly in the notice",
  COMMONLY_KNOWN_AS_PHRASE: "\"Commonly known as\" phrase in the notice",
  LEGAL_DESCRIPTION_MATCH: "Matched via legal description",
  PROPERTY_ID_MATCH: "Matched via property/geographic ID",
  OWNER_MAILING_ADDRESS_MATCH: "Matched via owner mailing address",
  GEOCODING: "Resolved via geocoding",
  MANUAL: "Corrected by an administrator",
  UNRESOLVED: "Not yet resolved",
};

export const fieldSourceLabels: Record<string, string> = {
  FORECLOSURE_NOTICE: "Foreclosure notice",
  COUNTY_CLERK: "County clerk record",
  APPRAISAL_DISTRICT: "Appraisal district record",
  GEOCODING_SERVICE: "Geocoding service",
  THIRD_PARTY_DATA: "Third-party data",
  CALCULATED: "Calculated estimate",
  MANUAL: "Manually verified",
};
