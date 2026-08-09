import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY diagnostic route -- pulls the (unchanged, untouched by the
 * extraction repair) property-resolution + valuation status for the same
 * 25 notices, needed to recompute investor-completeness (FULLY
 * USEFUL/USEFUL/LIMITED) after the extraction fix without re-deriving
 * CAD/resolver state that this repair explicitly did not alter
 * (extraction repair task, 2026-08-09). No writes. Gated behind
 * INTERNAL_INGEST_SECRET, fetched once, then neutered to a 410 stub. Same
 * pattern as this directory's other temporary routes.
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
      countyFilingNumber: true,
      property: {
        select: {
          propertyStreetAddress: true,
          addressResolutionMethod: true,
          addressResolutionConfidence: true,
          valuations: { select: { valuationType: true, valueCents: true } },
        },
      },
    },
  });

  return NextResponse.json({ count: cases.length, cases });
}
