import { NextResponse } from "next/server";

/** TEMPORARY diagnostic route — remove once the deploy is confirmed healthy. */
export async function GET() {
  const info: Record<string, unknown> = {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDirectUrl: Boolean(process.env.DIRECT_URL),
    databaseUrlHost: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : null,
  };

  try {
    const { prisma } = await import("@foreclosuredata/database");
    const count = await prisma.county.count();
    info.dbQuery = { ok: true, count };
  } catch (e) {
    info.dbQuery = {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }

  return NextResponse.json(info);
}
