import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 30;

// Exact filing numbers of the 82-case accepted baseline, captured by the
// pre-ingest-baseline route before this run -- used to prove the newly
// ingested notices are genuinely new, without relying on any assumption
// about filing-number ordering/ranges.
const KNOWN_82_FILING_NUMBERS = [
  "117716", "117732", "117910", "117911", "117912", "117918", "117920", "117925", "117927", "117928",
  "117929", "117931", "117936", "117940", "117949", "117950", "117951", "117957", "117958", "117990",
  "117991", "117992", "117993", "117994", "117999", "118006", "118133", "118156", "118157", "118158",
  "118183", "118184", "118185", "118186", "118187", "118188", "118189", "118190", "118191", "118192",
  "118193", "118194", "118195", "118196", "118198", "118199", "118200", "118201", "118202", "118203",
  "118204", "118205", "118206", "118207", "118208", "118209", "118210", "118211", "118212", "118213",
  "118214", "118215", "118216", "118217", "118218", "118219", "118220", "118221", "118222", "118223",
  "118224", "118225", "118226", "118227", "118228", "118229", "118230", "118231", "118233", "118234",
  "118235", "118236",
];

/**
 * Read-only, secret-gated: full detail dump of the 25 newly-ingested
 * Hidalgo notices from the fresh production ingestion run (2026-08-09),
 * for the post-run report (extraction/property-resolution/valuation/
 * manual-review metrics + 100% manual CAD-parcel verification). No
 * writes. Retired to a 410 stub once reviewed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const totalCases = await prisma.foreclosureCase.count();

    const newCases = await prisma.foreclosureCase.findMany({
      where: {
        documents: { some: { countyFilingNumber: { not: { in: KNOWN_82_FILING_NUMBERS } } } },
      },
      include: {
        county: true,
        property: true,
        borrower: true,
        grantor: true,
        currentOwner: true,
        documents: { select: { countyFilingNumber: true, filename: true, extractionConfidence: true, ocrUsed: true, manualReviewStatus: true, dateCollected: true } },
        legalDescriptions: true,
        loan: { include: { originalLender: true, currentMortgagee: true, mortgageServicer: true } },
        sales: true,
        manualReviewTasks: { select: { id: true, reason: true, status: true, notes: true } },
        appraisalCandidates: true,
        resolutionAttempts: true,
      },
      orderBy: { caseNumber: "asc" },
    });

    const propertyIds = newCases.map((c) => c.propertyId).filter((id): id is string => !!id);
    const valuations = propertyIds.length
      ? await prisma.appraisalValueHistory.findMany({ where: { propertyId: { in: propertyIds } } })
      : [];

    return NextResponse.json({
      totalCasesInProduction: totalCases,
      newCaseCount: newCases.length,
      newCases,
      valuations,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
