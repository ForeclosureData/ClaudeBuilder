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

/** Prisma `include` shape carrying exactly the fields computePublicationStatus() needs. Spread this into any ForeclosureCase query whose results will be shown to the public. */
export const PUBLICATION_STATUS_INCLUDE = {
  borrower: { select: { fullName: true } },
  property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
  legalDescriptions: { select: { id: true }, take: 1 },
  documents: { select: { id: true }, take: 1 },
  sales: { select: { saleDate: true }, orderBy: { saleDate: "desc" as const }, take: 1 },
  manualReviewTasks: { where: { status: "OPEN" as const }, select: { reason: true } },
  appraisalCandidates: { where: { isSelected: true }, select: { id: true }, take: 1 },
  duplicateLinksAsCaseA: { where: { status: "OPEN" as const, confidence: { in: ["CONFIRMED_SAME_EVENT" as const, "LIKELY_SAME_EVENT" as const] } }, select: { id: true }, take: 1 },
  duplicateLinksAsCaseB: { where: { status: "OPEN" as const, confidence: { in: ["CONFIRMED_SAME_EVENT" as const, "LIKELY_SAME_EVENT" as const] } }, select: { id: true }, take: 1 },
} satisfies Prisma.ForeclosureCaseInclude;

type CaseWithPublicationFields = Prisma.ForeclosureCaseGetPayload<{ include: typeof PUBLICATION_STATUS_INCLUDE }> & { archivedAt: Date | null };

export function toPublicationInput(c: CaseWithPublicationFields): PublicationInput {
  return {
    archivedAt: c.archivedAt,
    hasSourceDocument: c.documents.length > 0,
    saleDate: c.sales[0]?.saleDate ?? null,
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

export function getPublicationStatus(c: CaseWithPublicationFields): PublicationResult {
  return computePublicationStatus(toPublicationInput(c));
}

export function isPubliclyVisible(c: CaseWithPublicationFields): boolean {
  return isPubliclyVisibleStatus(getPublicationStatus(c).status);
}

/** Filters a fetched case array down to the publicly-visible subset. Use when the query couldn't pre-filter with archivedAt: null alone (i.e. always, since publication status depends on more than one column). */
export function filterPublic<T extends CaseWithPublicationFields>(cases: T[]): T[] {
  return cases.filter(isPubliclyVisible);
}
