import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

/**
 * One-time, read-only dump of full raw notice text plus persisted
 * property/candidate/resolution-attempt state for specific document
 * numbers -- used to inspect the 117643 out-of-county-address case and the
 * 117661 wrong-subdivision-enrichment case before writing fixes/repairs.
 * Same secret-gated, single-use, then-neutered pattern as this directory's
 * other temporary routes. Pass ?docs=117643,117661 for specific documents,
 * or ?all=1 for the full cached 24-record production-run window (used for
 * the post-fix re-score pass).
 */
const RUN_WINDOW_START = new Date("2026-08-07T22:19:00Z");
const RUN_WINDOW_END = new Date("2026-08-07T22:31:00Z");

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "1";
  const docs = (url.searchParams.get("docs") ?? "117643,117661").split(",").map((d) => d.trim());

  const cases = await prisma.foreclosureCase.findMany({
    where: all ? { createdAt: { gte: RUN_WINDOW_START, lte: RUN_WINDOW_END } } : { documents: { some: { countyFilingNumber: { in: docs } } } },
    orderBy: { createdAt: "asc" },
    include: {
      property: true,
      borrower: true,
      grantor: true,
      documents: true,
      legalDescriptions: true,
      appraisalCandidates: true,
      resolutionAttempts: true,
      manualReviewTasks: true,
    },
  });

  const records = cases.map((c) => ({
    foreclosureCaseId: c.id,
    documentNumber: c.documents[0]?.countyFilingNumber ?? null,
    borrowerName: c.borrower?.fullName ?? null,
    grantorName: c.grantor?.fullName ?? null,
    propertyId: c.propertyId,
    property: c.property,
    documents: c.documents.map((d) => ({ id: d.id, rawText: d.rawText, filename: d.filename })),
    legalDescriptions: c.legalDescriptions,
    appraisalCandidates: c.appraisalCandidates,
    resolutionAttempts: c.resolutionAttempts,
    manualReviewTasks: c.manualReviewTasks,
  }));

  return NextResponse.json({ count: records.length, records });
}
