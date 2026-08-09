/**
 * Single source of truth for "is this ForeclosureCase visible to the
 * public, and how should it be labeled." Every route that returns
 * foreclosure inventory to a non-admin visitor (homepage counts, county
 * page, property list, search, map, property detail, saved properties,
 * public API) must filter through isPubliclyVisible()/filterPublic() from
 * this module rather than re-deriving its own notion of "clean" -- see
 * publicationStatus.ts in @foreclosuredata/foreclosure-core for the actual
 * decision logic this wraps.
 *
 * Admin routes/pages must NOT import this module to restrict what they
 * fetch -- they intentionally see every non-archived case (that's the
 * whole point of the review queue). This module is exclusively for the
 * investor-facing surface.
 */
import { Prisma } from "@prisma/client";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput, type PublicationResult } from "@foreclosuredata/foreclosure-core";

/**
 * Additive Prisma `include` fragment for the relations
 * computePublicationStatus() needs that a typical list/detail query doesn't
 * already fetch (documents, legalDescriptions, manualReviewTasks,
 * appraisalCandidates, duplicate links). Deliberately has zero key overlap
 * with foreclosureCaseListInclude() in lib/properties.ts, so callers merge
 * it in with a plain object spread without any relation-shape conflict --
 * they keep whatever `property`/`sales`/`borrower` shape they already fetch
 * (as long as it's at least as rich as PublicationFieldsSource below, which
 * every existing caller's `true`/full-object fetch already is).
 */
export const PUBLICATION_EXTRA_INCLUDE = {
  legalDescriptions: { select: { id: true }, take: 1 },
  documents: { select: { id: true }, take: 1 },
  manualReviewTasks: { where: { status: "OPEN" as const }, select: { reason: true } },
  appraisalCandidates: { where: { isSelected: true }, select: { id: true }, take: 1 },
  duplicateLinksAsCaseA: { where: { status: "OPEN" as const, confidence: { in: ["CONFIRMED_SAME_EVENT" as const, "LIKELY_SAME_EVENT" as const] } }, select: { id: true }, take: 1 },
  duplicateLinksAsCaseB: { where: { status: "OPEN" as const, confidence: { in: ["CONFIRMED_SAME_EVENT" as const, "LIKELY_SAME_EVENT" as const] } }, select: { id: true }, take: 1 },
} satisfies Prisma.ForeclosureCaseInclude;

/** For a caller that ONLY needs publication status (e.g. an admin dashboard summarizing readiness) and doesn't already have a richer include. */
export const PUBLICATION_STATUS_INCLUDE = {
  ...PUBLICATION_EXTRA_INCLUDE,
  borrower: { select: { fullName: true } },
  property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
  sales: { select: { saleDate: true } },
} satisfies Prisma.ForeclosureCaseInclude;

/**
 * The minimal structural shape computePublicationStatus() needs -- declared
 * independently of any specific Prisma `include`, so any caller's richer
 * fetch (full `property: true`, full `sales`, full `borrower`, etc., plus
 * PUBLICATION_EXTRA_INCLUDE's relations) satisfies it without a cast.
 */
export interface PublicationFieldsSource {
  archivedAt: Date | null;
  documents: unknown[];
  sales: Array<{ saleDate: Date | null }>;
  borrower: { fullName: string } | null;
  property: { propertyStreetAddress: string | null; addressResolutionMethod: string; addressResolutionConfidence: number | null; subdivision: string | null; lot: string | null } | null;
  legalDescriptions: unknown[];
  appraisalCandidates: unknown[]; // must already be filtered to isSelected: true by the query
  manualReviewTasks: Array<{ reason: string }>; // must already be filtered to status: OPEN by the query
  duplicateLinksAsCaseA: unknown[]; // must already be filtered to OPEN + CONFIRMED/LIKELY by the query
  duplicateLinksAsCaseB: unknown[];
}

export function toPublicationInput(c: PublicationFieldsSource): PublicationInput {
  const saleDate = c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null;
  return {
    archivedAt: c.archivedAt,
    hasSourceDocument: c.documents.length > 0,
    saleDate,
    borrowerName: c.borrower?.fullName ?? null,
    propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
    addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
    addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
    hasLegalDescription: c.legalDescriptions.length > 0 || Boolean(c.property?.subdivision && c.property?.lot),
    hasCadConfirmedProperty: c.appraisalCandidates.length > 0,
    openManualReviewReasons: c.manualReviewTasks.map((t) => t.reason),
    hasActiveDuplicateLink: c.duplicateLinksAsCaseA.length > 0 || c.duplicateLinksAsCaseB.length > 0,
  };
}

export function getPublicationStatus(c: PublicationFieldsSource): PublicationResult {
  return computePublicationStatus(toPublicationInput(c));
}

export function isPubliclyVisible(c: PublicationFieldsSource): boolean {
  return isPubliclyVisibleStatus(getPublicationStatus(c).status);
}

/** Filters a fetched case array down to the publicly-visible subset. Always required -- archivedAt: null alone is not sufficient, since publication status depends on manual-review/duplicate-link/identity state too. */
export function filterPublic<T extends PublicationFieldsSource>(cases: T[]): T[] {
  return cases.filter(isPubliclyVisible);
}
