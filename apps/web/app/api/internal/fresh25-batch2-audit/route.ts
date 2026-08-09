import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY diagnostic route -- full audit data for the second fresh-25
 * batch (Phase 2 of the extraction-repair rollout, 2026-08-09): extraction
 * completeness, property-resolution status, CAD candidate detail, and raw
 * notice text for manual safety verification. No writes. Gated behind
 * INTERNAL_INGEST_SECRET, fetched once, then neutered to a 410 stub.
 */
const BATCH2_FILING_NUMBERS = [
  "117718", "117719", "117721", "117729", "117731",
  "117886", "117887", "117888", "117891", "117892", "117896",
  "117908", "117909", "117913", "117914", "117915", "117916", "117917", "117919",
  "117921", "117922", "117923", "117924", "117926", "117930",
];

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: BATCH2_FILING_NUMBERS } },
    select: {
      id: true,
      countyFilingNumber: true,
      caseNumber: true,
      borrower: { select: { fullName: true } },
      documents: { select: { id: true, rawText: true, extractionConfidence: true, status: true, manualReviewStatus: true, processingCostCents: true } },
      loan: {
        select: {
          originalPrincipalAmountCents: true,
          currentPrincipalBalanceCents: true,
          deedOfTrustDate: true,
          instrumentNumber: true,
          recordingDate: true,
          originalLender: { select: { name: true } },
          currentMortgagee: { select: { name: true } },
          mortgageServicer: { select: { name: true } },
        },
      },
      sales: { select: { saleDate: true, saleTime: true, saleLocation: true } },
      legalDescriptions: { select: { rawText: true, subdivision: true, lot: true, block: true } },
      manualReviewTasks: { select: { reason: true, status: true, notes: true } },
      property: {
        select: {
          propertyStreetAddress: true,
          subdivision: true,
          lot: true,
          block: true,
          propertyIdNumber: true,
          geographicId: true,
          addressResolutionMethod: true,
          addressResolutionConfidence: true,
          addressResolutionExplanation: true,
          appraisedValueCents: true,
          assessedValueCents: true,
          estimatedMarketValueCents: true,
          valuations: { select: { valuationType: true, valueCents: true } },
        },
      },
      appraisalCandidates: {
        select: {
          sourcePropertyId: true,
          situsAddress: true,
          ownerName: true,
          subdivision: true,
          lot: true,
          block: true,
          legalDescription: true,
          score: true,
          isSelected: true,
        },
      },
    },
  });

  return NextResponse.json({ count: cases.length, cases });
}
