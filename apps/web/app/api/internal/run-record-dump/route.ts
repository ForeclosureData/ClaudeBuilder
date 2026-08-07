import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

/**
 * One-time, read-only dump of the 25-notice bounded production run's
 * persisted records (GH Actions run 31223343595, 2026-08-07 22:19-22:30
 * UTC) -- full rawText plus every field needed to (a) classify each
 * record's manual-review reason and (b) mine real Hidalgo lender/
 * mortgagee/beneficiary phrasing for the new deterministic extractor.
 * Same secret-gated, single-use, then-neutered pattern as this
 * directory's other temporary routes.
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
      loan: { include: { originalLender: true, currentMortgagee: true, mortgageServicer: true } },
      sales: true,
      legalDescriptions: true,
      manualReviewTasks: true,
      appraisalCandidates: true,
      resolutionAttempts: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const records = cases.map((c) => ({
    foreclosureCaseId: c.id,
    documentNumber: c.documents[0]?.countyFilingNumber ?? null,
    extractionConfidence: c.documents[0]?.extractionConfidence ?? null,
    extractionStatus: c.documents[0]?.status ?? null,
    rawText: c.documents[0]?.rawText ?? null,
    borrowerName: c.borrower?.fullName ?? null,
    lenderName: c.loan?.originalLender?.name ?? null,
    currentMortgageeName: c.loan?.currentMortgagee?.name ?? null,
    mortgageServicerName: c.loan?.mortgageServicer?.name ?? null,
    saleDate: c.sales[0]?.saleDate ?? null,
    property: c.property
      ? {
          streetAddress: c.property.propertyStreetAddress,
          addressResolutionMethod: c.property.addressResolutionMethod,
          addressResolutionConfidence: c.property.addressResolutionConfidence,
        }
      : null,
    legalDescriptionCount: c.legalDescriptions.length,
    manualReviewReasons: c.manualReviewTasks.map((t) => t.reason),
    appraisalCandidateCount: c.appraisalCandidates.length,
    hasSelectedCandidate: c.appraisalCandidates.some((ac) => ac.isSelected),
    latestResolutionAttempt: c.resolutionAttempts.length
      ? {
          confidence: c.resolutionAttempts[c.resolutionAttempts.length - 1]!.confidence,
          matchedFields: c.resolutionAttempts[c.resolutionAttempts.length - 1]!.matchedFields,
          conflictingFields: c.resolutionAttempts[c.resolutionAttempts.length - 1]!.conflictingFields,
          candidateCount: c.resolutionAttempts[c.resolutionAttempts.length - 1]!.candidateCount,
          requiresManualReview: c.resolutionAttempts[c.resolutionAttempts.length - 1]!.requiresManualReview,
        }
      : null,
  }));

  return NextResponse.json({ runWindow: { start: RUN_WINDOW_START.toISOString(), end: RUN_WINDOW_END.toISOString() }, count: records.length, records });
}
