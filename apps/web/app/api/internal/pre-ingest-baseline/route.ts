import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 30;

/**
 * Read-only, secret-gated: snapshots the current baseline immediately
 * before a fresh 25-notice production ingestion run, so the post-run
 * audit can prove the new notices are genuinely new (no filing-number
 * overlap with the 82-case baseline) and so "currently ingested unique
 * notice count" is measured, not assumed. No writes. Retired to a 410
 * stub once reviewed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [foreclosureCaseCount, sourceDocuments, ingestedBundles, county] = await Promise.all([
      prisma.foreclosureCase.count(),
      prisma.sourceDocument.findMany({ select: { countyFilingNumber: true, filename: true, dateCollected: true } }),
      prisma.ingestedNoticeBundle.findMany({ select: { id: true, status: true, externalId: true, discoveredAt: true, processedAt: true, adapterKey: true } }),
      prisma.county.findFirst({ where: { slug: "hidalgo-tx" }, select: { id: true, slug: true, name: true } }),
    ]);

    const filingNumbers = sourceDocuments.map((d) => d.countyFilingNumber).filter((n): n is string => !!n);

    return NextResponse.json({
      snapshotAt: new Date().toISOString(),
      county,
      foreclosureCaseCount,
      sourceDocumentCount: sourceDocuments.length,
      distinctFilingNumberCount: new Set(filingNumbers).size,
      filingNumbers: filingNumbers.sort(),
      ingestedNoticeBundles: ingestedBundles,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
