import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * TEMPORARY, one-off repair route — netlify.toml's build command ran
 * `prisma db push` with `|| true` (so a schema-push failure didn't block
 * an otherwise-good deploy), which turned out to have been silently
 * leaving production schema drift for a while (found via the missing
 * ingested_notice_bundles table this session added). netlify.toml has
 * since been fixed to stop swallowing that failure — this route exists
 * only to close the drift that already accumulated, by hand, and is
 * deleted immediately after use. Accepts an optional `statements: string[]`
 * body to run additional catch-up DDL beyond the default batch below,
 * since drift turned out to span more than one session's changes.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const extraStatements: string[] = Array.isArray(body.statements) ? body.statements : [];

  const statements = [
    `CREATE TYPE "IngestedBundleStatus" AS ENUM ('DISCOVERED', 'DOWNLOADING', 'SPLITTING', 'SPLIT_COMPLETE', 'FAILED')`,
    `CREATE TABLE "ingested_notice_bundles" (
      "id" TEXT NOT NULL,
      "county_id" TEXT NOT NULL,
      "adapter_key" TEXT NOT NULL,
      "external_id" TEXT NOT NULL,
      "source_url" TEXT NOT NULL,
      "document_url" TEXT NOT NULL,
      "bundle_sha256" TEXT,
      "notice_count" INTEGER,
      "split_success_count" INTEGER,
      "status" "IngestedBundleStatus" NOT NULL DEFAULT 'DISCOVERED',
      "error_message" TEXT,
      "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "processed_at" TIMESTAMP(3),
      "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ingested_notice_bundles_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX "ingested_notice_bundles_county_id_adapter_key_external_id_key" ON "ingested_notice_bundles"("county_id", "adapter_key", "external_id")`,
    `CREATE INDEX "ingested_notice_bundles_status_idx" ON "ingested_notice_bundles"("status")`,
    `ALTER TABLE "ingested_notice_bundles" ADD CONSTRAINT "ingested_notice_bundles_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    ...extraStatements,
  ];

  const results: Array<{ statement: string; ok: boolean; error?: string }> = [];
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push({ statement: sql.slice(0, 60), ok: true });
    } catch (err) {
      results.push({ statement: sql.slice(0, 60), ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const existingTables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );

  return NextResponse.json({ results, existingTables: existingTables.map((t) => t.table_name) });
}
