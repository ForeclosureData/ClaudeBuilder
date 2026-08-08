import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 30;

/**
 * Read-only, secret-gated: lists all 82 baseline ForeclosureCase rows with
 * exactly the fields needed to hand-pick a representative 10-case pilot
 * sample (existing-address vs NO_ADDRESS_RESOLVED, subdivision+lot/block
 * vs owner-only evidence, at least one messy/ambiguous case). No writes.
 * Retired to a 410 stub once the 10 cases are chosen and documented.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cases = await prisma.foreclosureCase.findMany({
      select: {
        id: true,
        caseNumber: true,
        propertyId: true,
        property: {
          select: {
            propertyStreetAddress: true,
            city: true,
            subdivision: true,
            lot: true,
            block: true,
            addressResolutionMethod: true,
          },
        },
        legalDescriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { rawText: true, subdivision: true, lot: true, block: true },
        },
        borrower: { select: { fullName: true } },
        grantor: { select: { fullName: true } },
        manualReviewTasks: { select: { id: true, reason: true, status: true, notes: true } },
        documents: { select: { filename: true, extractionConfidence: true, manualReviewStatus: true } },
      },
      orderBy: { caseNumber: "asc" },
    });

    const summary = cases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      hasProperty: !!c.propertyId,
      addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
      propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
      subdivision: c.property?.subdivision ?? c.legalDescriptions[0]?.subdivision ?? null,
      lot: c.property?.lot ?? c.legalDescriptions[0]?.lot ?? null,
      block: c.property?.block ?? c.legalDescriptions[0]?.block ?? null,
      legalRawTextPreview: c.legalDescriptions[0]?.rawText?.slice(0, 120) ?? null,
      borrower: c.borrower?.fullName ?? null,
      grantor: c.grantor?.fullName ?? null,
      openReviewReasons: c.manualReviewTasks.filter((t) => t.status === "OPEN").map((t) => t.reason),
      sourceExtractionConfidence: c.documents[0]?.extractionConfidence ?? null,
      sourceManualReviewStatus: c.documents[0]?.manualReviewStatus ?? null,
    }));

    return NextResponse.json({
      totalCases: cases.length,
      withAddress: summary.filter((s) => s.hasProperty).length,
      unresolved: summary.filter((s) => !s.hasProperty).length,
      cases: summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
