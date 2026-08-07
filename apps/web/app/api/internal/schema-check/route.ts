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
