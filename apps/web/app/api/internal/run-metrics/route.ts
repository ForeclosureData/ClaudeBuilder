import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

/**
 * One-time, read-only report of the 25-notice bounded production run
 * (GH Actions run 31223343595, 2026-08-07 22:19-22:30 UTC) — computes the
 * property-resolution/valuation/publication metrics that aren't already
 * printed by ci-ingest-hidalgo.mts's own summary log. Scoped to
 * ForeclosureCase rows created during that run's window. Same
 * secret-gated, single-use, then-neutered pattern as this directory's
 * other temporary routes.
 */
const RUN_WINDOW_START = new Date("2026-08-07T22:19:00Z");
const RUN_WINDOW_END = new Date("2026-08-07T22:31:00Z");

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cases = await prisma.foreclosureCase.findMany({
    where: { createdAt: { gte: RUN_WINDOW_START, lte: RUN_WINDOW_END } },
    include: {
      property: true,
      borrower: true,
      grantor: true,
      documents: true,
      loan: { include: { originalLender: true } },
      sales: true,
      legalDescriptions: true,
      manualReviewTasks: true,
      appraisalCandidates: true,
      resolutionAttempts: true,
    },
  });

  const propertyIds = cases.map((c) => c.propertyId).filter((id): id is string => id !== null);
  const historyRows = await prisma.appraisalValueHistory.findMany({ where: { propertyId: { in: propertyIds } } });
  const historyByProperty = new Map<string, typeof historyRows>();
  for (const row of historyRows) {
    const list = historyByProperty.get(row.propertyId) ?? [];
    list.push(row);
    historyByProperty.set(row.propertyId, list);
  }

  const total = cases.length;
  let borrowerExtracted = 0;
  let saleDateExtracted = 0;
  let legalDescriptionExtracted = 0;
  let explicitAddressExtracted = 0;

  let explicitResolutionCount = 0;
  let cadAssistedResolutionCount = 0;
  let anyAddressResolvedCount = 0;
  let automaticCadMatchCount = 0;
  let manualReviewCount = 0;
  let ambiguousMatchCount = 0;
  let conflictingOwnerCount = 0;
  let textualBorrowerConflictCount = 0;
  let cadOwnerConflictCount = 0;

  let confirmedCadParcelCount = 0;
  let hasMarketValueCount = 0;
  let hasAppraisedValueCount = 0;
  let requiresPriorYearFallbackCount = 0;
  const taxYearCounts = new Map<number, number>();

  let autoPublishable = 0;
  let heldForReview = 0;
  let missingAddress = 0;
  let missingValuation = 0;
  let missingLenderOrBorrower = 0;
  let missingLenderCount = 0;
  let missingBorrowerCount = 0;

  for (const c of cases) {
    if (c.borrower && c.borrower.fullName !== "Unknown owner") borrowerExtracted++;
    if (c.sales.length > 0 && c.sales[0]?.saleDate) saleDateExtracted++;
    if (c.legalDescriptions.length > 0) legalDescriptionExtracted++;

    const method = c.property?.addressResolutionMethod;
    if (method === "EXPLICIT_STATED" || method === "COMMONLY_KNOWN_AS_PHRASE") {
      explicitAddressExtracted++;
      explicitResolutionCount++;
    } else if (method && method !== "UNRESOLVED") {
      cadAssistedResolutionCount++;
    }
    if (c.property) anyAddressResolvedCount++;
    else missingAddress++;

    const selectedCandidate = c.appraisalCandidates.find((ac) => ac.isSelected);
    if (selectedCandidate) {
      automaticCadMatchCount++;
      confirmedCadParcelCount++;
    }

    const reasons = c.manualReviewTasks.map((t) => t.reason);
    if (reasons.length > 0) {
      manualReviewCount++;
      heldForReview++;
    } else {
      autoPublishable++;
    }
    if (reasons.includes("MULTIPLE_APPRAISAL_MATCHES")) ambiguousMatchCount++;

    // Two distinct signals can both indicate a conflicting owner for the
    // same case -- BORROWER_NAME_CONFLICT (extraction pipeline: the notice
    // text itself names inconsistent borrowers) and a resolver-attempt
    // conflictingFields entry (CAD's on-record owner doesn't match the
    // notice's stated borrower/grantor). Counted once per case, not once
    // per signal, so a case with both doesn't inflate the rate.
    const latestAttempt = c.resolutionAttempts[c.resolutionAttempts.length - 1];
    const hasTextualBorrowerConflict = reasons.includes("BORROWER_NAME_CONFLICT");
    const hasCadOwnerConflict = latestAttempt?.conflictingFields?.some((f) => /owner/i.test(f)) ?? false;
    if (hasTextualBorrowerConflict || hasCadOwnerConflict) conflictingOwnerCount++;
    if (hasTextualBorrowerConflict) textualBorrowerConflictCount++;
    if (hasCadOwnerConflict) cadOwnerConflictCount++;

    const history = c.propertyId ? (historyByProperty.get(c.propertyId) ?? []) : [];
    const hasMarket = history.some((h) => h.marketValueCents !== null);
    const hasAppraised = history.some((h) => h.appraisedValueCents !== null);
    if (hasMarket) hasMarketValueCount++;
    if (hasAppraised) hasAppraisedValueCount++;
    if (history.length === 0) missingValuation++;

    for (const h of history) taxYearCounts.set(h.taxYear, (taxYearCounts.get(h.taxYear) ?? 0) + 1);
    const maxAvailableYear = history.length > 0 ? Math.max(...history.map((h) => h.taxYear)) : null;
    if (maxAvailableYear !== null && selectedCandidate?.taxYear && selectedCandidate.taxYear > maxAvailableYear) {
      requiresPriorYearFallbackCount++;
    }

    const lenderKnown = c.loan?.originalLender && c.loan.originalLender.name !== "Unknown lender";
    const borrowerKnown = c.borrower && c.borrower.fullName !== "Unknown owner";
    if (!lenderKnown) missingLenderCount++;
    if (!borrowerKnown) missingBorrowerCount++;
    if (!lenderKnown || !borrowerKnown) missingLenderOrBorrower++;
  }

  let mostCommonValuationYear: number | null = null;
  let mostCommonValuationYearCount = 0;
  for (const [year, count] of taxYearCounts.entries()) {
    if (count > mostCommonValuationYearCount) {
      mostCommonValuationYear = year;
      mostCommonValuationYearCount = count;
    }
  }

  return NextResponse.json({
    runWindow: { start: RUN_WINDOW_START.toISOString(), end: RUN_WINDOW_END.toISOString() },
    totalPersistedCases: total,
    extraction: {
      borrowerGrantorExtractedCount: borrowerExtracted,
      saleDateExtractedCount: saleDateExtracted,
      legalDescriptionExtractedCount: legalDescriptionExtracted,
      explicitAddressExtractedCount: explicitAddressExtracted,
    },
    propertyResolution: {
      explicitResolutionCount,
      cadAssistedResolutionCount,
      anyAddressResolvedCount,
      automaticCadMatchCount,
      manualReviewCount,
      ambiguousMatchCount,
      conflictingOwnerCount,
      textualBorrowerConflictCount,
      cadOwnerConflictCount,
    },
    valuation: {
      confirmedCadParcelCount,
      hasMarketValueCount,
      hasAppraisedValueCount,
      requiresPriorYearFallbackCount,
      taxYearDistribution: Object.fromEntries(taxYearCounts),
      mostCommonValuationYear,
    },
    publication: {
      autoPublishable,
      heldForReview,
      missingAddress,
      missingValuation,
      missingLenderOrBorrower,
      missingLenderCount,
      missingBorrowerCount,
    },
  });
}
