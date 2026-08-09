import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 30;

/**
 * Read-only, secret-gated: full-82-case baseline audit after the CAD
 * regeneration effort (10-case pilot + HID-118198 closeout + 72-case
 * bulk run). No writes. Retired to a 410 stub once reviewed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [
      totalCases,
      withAddress,
      unresolved,
      propertyIdNumberSet,
      appraisalValueHistoryCount,
      taxYearGroups,
      marketValuePopulated,
      appraisedValuePopulated,
      landValuePopulated,
      improvementValuePopulated,
      certifiedTrue,
      certifiedFalse,
      certifiedNull,
      openReviewTasksByReason,
      totalOpenReviewTasks,
      appraisalCandidateCount,
      distinctCasesWithCandidates,
    ] = await Promise.all([
      prisma.foreclosureCase.count(),
      prisma.foreclosureCase.count({ where: { propertyId: { not: null } } }),
      prisma.foreclosureCase.count({ where: { propertyId: null } }),
      prisma.property.count({ where: { propertyIdNumber: { not: null } } }),
      prisma.appraisalValueHistory.count(),
      prisma.appraisalValueHistory.groupBy({ by: ["taxYear"], _count: true }),
      prisma.appraisalValueHistory.count({ where: { marketValueCents: { not: null } } }),
      prisma.appraisalValueHistory.count({ where: { appraisedValueCents: { not: null } } }),
      prisma.appraisalValueHistory.count({ where: { landValueCents: { not: null } } }),
      prisma.appraisalValueHistory.count({ where: { improvementValueCents: { not: null } } }),
      prisma.appraisalValueHistory.count({ where: { certified: true } }),
      prisma.appraisalValueHistory.count({ where: { certified: false } }),
      prisma.appraisalValueHistory.count({ where: { certified: null } }),
      prisma.manualReviewTask.groupBy({ by: ["reason"], _count: true, where: { status: "OPEN" } }),
      prisma.manualReviewTask.count({ where: { status: "OPEN" } }),
      prisma.appraisalPropertyCandidate.count(),
      prisma.appraisalPropertyCandidate.findMany({ select: { foreclosureCaseId: true }, distinct: ["foreclosureCaseId"] }),
    ]);

    // Confirmed-parcel-with-no-valuation: properties with propertyIdNumber set (CAD-confirmed) but zero AppraisalValueHistory rows.
    const confirmedPropertyIds = await prisma.property.findMany({ where: { propertyIdNumber: { not: null } }, select: { id: true } });
    const propertyIdsWithValuation = await prisma.appraisalValueHistory.findMany({ select: { propertyId: true }, distinct: ["propertyId"] });
    const valuationSet = new Set(propertyIdsWithValuation.map((v) => v.propertyId));
    const confirmedNoValuation = confirmedPropertyIds.filter((p) => !valuationSet.has(p.id)).length;

    // Notice-transcribed field integrity: still exactly 46/36 and no drift.
    const addressResolutionMethods = await prisma.property.groupBy({ by: ["addressResolutionMethod"], _count: true });

    return NextResponse.json({
      propertyAddress: {
        totalCases,
        noticeDerivedAddressCount: withAddress,
        unresolvedAddressCount: unresolved,
        cadConfirmedParcelCount: propertyIdNumberSet,
        addressResolutionMethodBreakdown: addressResolutionMethods,
      },
      valuation: {
        appraisalValueHistoryRows: appraisalValueHistoryCount,
        marketValuePopulated,
        appraisedValuePopulated,
        landValuePopulated,
        improvementValuePopulated,
        taxYearDistribution: taxYearGroups,
        certified: { true: certifiedTrue, false: certifiedFalse, null: certifiedNull },
        confirmedParcelCount: propertyIdNumberSet,
        confirmedParcelWithNoValuation: confirmedNoValuation,
      },
      manualReview: {
        totalOpenReviewTasks,
        reasonDistribution: openReviewTasksByReason,
        totalAppraisalCandidateRows: appraisalCandidateCount,
        distinctCasesWithCandidates: distinctCasesWithCandidates.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
