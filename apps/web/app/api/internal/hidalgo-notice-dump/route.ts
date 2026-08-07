import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY diagnostic route -- pulls raw OCR text for the 5 real Hidalgo
 * notices from the first bounded production run, so their real phrasing
 * can be inspected offline to improve the deterministic borrower/grantor
 * parser. Same pattern as the retired render-debug route: gated behind
 * INTERNAL_INGEST_SECRET, fetched once, then neutered back to a 410 stub
 * immediately after use -- never left exposed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await prisma.sourceDocument.findMany({
    where: { countyFilingNumber: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      countyFilingNumber: true,
      extractionConfidence: true,
      manualReviewStatus: true,
      status: true,
      rawText: true,
    },
  });

  return NextResponse.json({ docs });
}
