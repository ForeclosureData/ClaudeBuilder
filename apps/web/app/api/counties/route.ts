import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

/**
 * Deliberately request-time only (no `revalidate`/ISR): with `revalidate`
 * set, Next.js treats this as a static route and executes it during
 * `next build` itself to seed the initial cache, which makes the build
 * depend on a working database connection. This is a small, cheap query —
 * running it per-request instead of caching it isn't worth that coupling.
 */
export const dynamic = "force-dynamic";

/** Small, public list — powers the homepage/nav county search and mobile's county picker. */
export async function GET() {
  const counties = await prisma.county.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { slug: true, name: true, state: true, isActive: true },
  });
  return NextResponse.json(counties);
}
