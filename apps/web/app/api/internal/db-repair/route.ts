import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY, reactivated once more to reset a specific stale
 * IngestedNoticeBundle row: an early live probe (before the
 * bounded-run-shouldn't-mark-SPLIT_COMPLETE fix existed) marked the
 * August 2026 bundle SPLIT_COMPLETE with splitSuccessCount 0, which now
 * incorrectly short-circuits every retry via the bundleSha256-match skip
 * check. Resets it to SPLITTING so the next run actually reprocesses it.
 * Re-neutered to a 410 stub immediately after this one use.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updated = await prisma.ingestedNoticeBundle.updateMany({
    where: { adapterKey: "hidalgo", status: "SPLIT_COMPLETE", splitSuccessCount: 0 },
    data: { status: "SPLITTING" },
  });

  return NextResponse.json({ resetCount: updated.count });
}
