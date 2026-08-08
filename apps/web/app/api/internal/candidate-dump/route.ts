import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

/**
 * One-time, read-only dump of the 25-notice run's persisted
 * AppraisalPropertyCandidate rows plus the notice-side evidence needed to
 * classify each unresolved/manual-review case's CAD failure mode and to
 * re-score the already-gathered candidate pool locally (no new CAD
 * requests). Same secret-gated, single-use, then-neutered pattern as this
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
      documents: { select: { countyFilingNumber: true } },
      legalDescriptions: true,
      appraisalCandidates: true,
      resolutionAttempts: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const records = cases.map((c) => ({
    documentNumber: c.documents[0]?.countyFilingNumber ?? null,
    borrowerName: c.borrower?.fullName ?? null,
    grantorName: c.grantor?.fullName ?? null,
    property: c.property
      ? {
          streetAddress: c.property.propertyStreetAddress,
          subdivision: c.property.subdivision,
          lot: c.property.lot,
          block: c.property.block,
          acreage: c.property.acreage,
          addressResolutionMethod: c.property.addressResolutionMethod,
        }
      : null,
    legalDescriptions: c.legalDescriptions.map((ld) => ({
      rawText: ld.rawText,
      subdivision: ld.subdivision,
      lot: ld.lot,
      block: ld.block,
      acreage: ld.acreage,
    })),
    resolutionAttempts: c.resolutionAttempts.map((ra) => ({
      resolutionMethod: ra.resolutionMethod,
      confidence: ra.confidence,
      explanation: ra.explanation,
      matchedFields: ra.matchedFields,
      conflictingFields: ra.conflictingFields,
      candidateCount: ra.candidateCount,
      requiresManualReview: ra.requiresManualReview,
      selectedCandidateId: ra.selectedCandidateId,
    })),
    candidates: c.appraisalCandidates.map((ac) => ({
      sourcePropertyId: ac.sourcePropertyId,
      ownerName: ac.ownerName,
      situsAddress: ac.situsAddress,
      city: ac.city,
      zipCode: ac.zipCode,
      parcelId: ac.parcelId,
      geographicId: ac.geographicId,
      legalDescription: ac.legalDescription,
      subdivision: ac.subdivision,
      lot: ac.lot,
      block: ac.block,
      acreage: ac.acreage,
      taxYear: ac.taxYear,
      isSelected: ac.isSelected,
    })),
  }));

  return NextResponse.json({ runWindow: { start: RUN_WINDOW_START.toISOString(), end: RUN_WINDOW_END.toISOString() }, count: records.length, records });
}
