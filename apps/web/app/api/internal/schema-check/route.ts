import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * One-time pre/post-migration verification for the AppraisalValueHistory
 * `certified` column rollout. Gated behind INTERNAL_INGEST_SECRET like the
 * other internal routes. Retire (410 stub, matching the other routes in
 * this directory) once the production migration is confirmed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [columns, foreclosureCaseCount, propertyCount, sourceDocumentCount, appraisalCandidateCount, appraisalValueHistoryCount, propertyResolutionAttemptCount] =
      await Promise.all([
        prisma.$queryRaw`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'appraisal_value_history' ORDER BY ordinal_position`,
        prisma.foreclosureCase.count(),
        prisma.property.count(),
        prisma.sourceDocument.count(),
        prisma.appraisalPropertyCandidate.count(),
        prisma.appraisalValueHistory.count(),
        prisma.propertyResolutionAttempt.count(),
      ]);

    return NextResponse.json({
      appraisalValueHistoryColumns: columns,
      rowCounts: {
        foreclosureCase: foreclosureCaseCount,
        property: propertyCount,
        sourceDocument: sourceDocumentCount,
        appraisalPropertyCandidate: appraisalCandidateCount,
        appraisalValueHistory: appraisalValueHistoryCount,
        propertyResolutionAttempt: propertyResolutionAttemptCount,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * Applies exactly the additive, nullable column `prisma db push` would
 * generate for the AppraisalValueHistory.certified change -- used because
 * the build-time `db:push` step didn't appear to reach this database (the
 * column was still missing per GET above), while this route's own Prisma
 * connection is confirmed reachable. IF NOT EXISTS makes this safe to
 * call more than once; it never touches existing rows/columns.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "appraisal_value_history" ADD COLUMN IF NOT EXISTS "certified" boolean;`);
    const columns = await prisma.$queryRaw`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'appraisal_value_history' ORDER BY ordinal_position`;
    return NextResponse.json({ ok: true, appraisalValueHistoryColumns: columns });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
