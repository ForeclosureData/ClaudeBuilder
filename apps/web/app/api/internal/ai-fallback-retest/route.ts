import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { extractDeterministic, needsAiFallback, extractWithAI } from "@foreclosuredata/foreclosure-core";

export const maxDuration = 120;

/**
 * One-time, bounded verification that the extractWithAI max_tokens fix
 * (2000 -> 4096, see extractWithAI.ts) actually resolves the 100% AI
 * fallback merge failure observed in the 25-notice production run (GH
 * Actions run 31223343595 -- 15 calls made, $0.60 spent, 0 merged). Reuses
 * the SAME cached rawText already persisted for those 24 records -- no new
 * ingestion, no new notices, no database writes. A small, explicit dollar
 * cap bounds the spend. Same secret-gated, single-use, then-neutered
 * pattern as this directory's other temporary routes.
 */
const RUN_WINDOW_START = new Date("2026-08-07T22:19:00Z");
const RUN_WINDOW_END = new Date("2026-08-07T22:31:00Z");
const MAX_SPEND_CENTS = 100;

export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await prisma.sourceDocument.findMany({
    where: { createdAt: { gte: RUN_WINDOW_START, lte: RUN_WINDOW_END }, rawText: { not: null } },
    select: { countyFilingNumber: true, rawText: true },
    orderBy: { createdAt: "asc" },
  });

  let spentCents = 0;
  const budget = {
    async hasHeadroom(): Promise<boolean> {
      return spentCents < MAX_SPEND_CENTS;
    },
    async recordSpend(costCents: number): Promise<void> {
      spentCents += costCents;
    },
  };

  const results: Array<{
    documentNumber: string | null;
    ranAiExtraction: boolean;
    merged: boolean;
    reason?: string;
    recoveredFields: string[];
  }> = [];

  for (const doc of docs) {
    if (!doc.rawText) continue;
    const deterministic = extractDeterministic(doc.rawText);
    if (!needsAiFallback(deterministic)) continue;
    if (!(await budget.hasHeadroom())) {
      results.push({ documentNumber: doc.countyFilingNumber, ranAiExtraction: false, merged: false, reason: "local retest budget cap reached", recoveredFields: [] });
      continue;
    }

    const outcome = await extractWithAI(doc.rawText, budget);
    const recoveredFields: string[] = [];
    if (outcome.ranAiExtraction && outcome.result) {
      for (const key of Object.keys(deterministic) as Array<keyof typeof deterministic>) {
        const before = deterministic[key];
        const after = outcome.result[key];
        if (before.value === null && after.value !== null) recoveredFields.push(key);
      }
    }

    results.push({
      documentNumber: doc.countyFilingNumber,
      ranAiExtraction: outcome.ranAiExtraction,
      merged: Boolean(outcome.ranAiExtraction && outcome.result),
      reason: outcome.reason,
      recoveredFields,
    });
  }

  return NextResponse.json({
    totalDocsInWindow: docs.length,
    attempted: results.length,
    merged: results.filter((r) => r.merged).length,
    failed: results.filter((r) => r.ranAiExtraction && !r.merged).length,
    totalSpendCents: spentCents,
    results,
  });
}
