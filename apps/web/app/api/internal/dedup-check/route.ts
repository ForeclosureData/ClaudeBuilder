import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

/**
 * One-time, read-only check for duplicate ForeclosureCase rows sharing the
 * same county filing number -- triggered by a suspected dedup failure in
 * the 25-new-notice generalization-test run (2026-08-08), where notices
 * already present from the earlier 24-record cached sample appeared to be
 * re-processed as "new" instead of being recognized as duplicates. Same
 * secret-gated, single-use, then-neutered pattern as this directory's
 * other temporary routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await prisma.sourceDocument.findMany({
    where: { countyFilingNumber: { not: null } },
    select: {
      id: true,
      countyFilingNumber: true,
      sha256Hash: true,
      createdAt: true,
      foreclosureCaseId: true,
    },
    orderBy: { countyFilingNumber: "asc" },
  });

  const byFilingNumber = new Map<string, typeof docs>();
  for (const d of docs) {
    const key = d.countyFilingNumber!;
    if (!byFilingNumber.has(key)) byFilingNumber.set(key, []);
    byFilingNumber.get(key)!.push(d);
  }

  const duplicates = Array.from(byFilingNumber.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([filingNumber, rows]) => ({ filingNumber, count: rows.length, rows }));

  const totalCases = await prisma.foreclosureCase.count();

  return NextResponse.json({
    totalSourceDocuments: docs.length,
    totalForeclosureCases: totalCases,
    distinctFilingNumbers: byFilingNumber.size,
    duplicateFilingNumberCount: duplicates.length,
    duplicates,
  });
}
