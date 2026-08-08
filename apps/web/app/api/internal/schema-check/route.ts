import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * One-time pre/post-migration verification for the ManualReviewReason
 * `CAD_OWNER_CONFLICT` enum value rollout. Gated behind INTERNAL_INGEST_SECRET
 * like the other internal routes. Retire (410 stub, matching the other routes
 * in this directory) once the production migration is confirmed.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [enumValues, manualReviewTaskCount, cadOwnerConflictCount] = await Promise.all([
      prisma.$queryRaw`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'ManualReviewReason'::regtype ORDER BY enumsortorder`,
      prisma.manualReviewTask.count(),
      prisma.manualReviewTask.count({ where: { reason: "CAD_OWNER_CONFLICT" } }),
    ]);

    return NextResponse.json({
      manualReviewReasonEnumValues: enumValues,
      rowCounts: {
        manualReviewTask: manualReviewTaskCount,
        manualReviewTaskCadOwnerConflict: cadOwnerConflictCount,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * Adds exactly the new enum label `prisma db push` would generate for the
 * ManualReviewReason.CAD_OWNER_CONFLICT addition -- used because the
 * build-time `db:push` step has previously failed to reach this database
 * (confirmed via the certified-column incident), while this route's own
 * Prisma connection is confirmed reachable. IF NOT EXISTS makes this safe
 * to call more than once; it never touches existing enum values or rows.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "ManualReviewReason" ADD VALUE IF NOT EXISTS 'CAD_OWNER_CONFLICT';`);
    const enumValues = await prisma.$queryRaw`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'ManualReviewReason'::regtype ORDER BY enumsortorder`;
    return NextResponse.json({ ok: true, manualReviewReasonEnumValues: enumValues });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
