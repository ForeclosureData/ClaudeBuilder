import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY diagnostic route -- full current production state for the same
 * 25 fresh-test notices, needed to design the Phase 1 backfill's per-field
 * supersession logic against real data before writing any code (extraction
 * backfill task, 2026-08-09). No writes. Gated behind
 * INTERNAL_INGEST_SECRET, fetched once, then neutered to a 410 stub.
 */
const FRESH_25_FILING_NUMBERS = [
  "117630", "117631", "117632", "117633", "117634", "117635", "117642", "117643",
  "117648", "117651", "117652", "117658", "117659", "117660", "117661", "117675",
  "117695", "117697", "117698", "117700", "117701", "117702", "117707", "117708", "117710",
];

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: FRESH_25_FILING_NUMBERS } },
    select: {
      id: true,
      countyFilingNumber: true,
      caseNumber: true,
      borrowerPersonId: true,
      grantorPersonId: true,
      currentOwnerPersonId: true,
      borrower: { select: { id: true, fullName: true } },
      documents: { select: { id: true, extractionConfidence: true, status: true, manualReviewStatus: true } },
      loan: {
        select: {
          id: true,
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
      sales: { select: { id: true, saleDate: true, saleTime: true, saleLocation: true } },
      legalDescriptions: { select: { id: true, rawText: true, subdivision: true, lot: true, block: true } },
      manualReviewTasks: { select: { reason: true, status: true } },
    },
  });

  return NextResponse.json({ count: cases.length, cases });
}
