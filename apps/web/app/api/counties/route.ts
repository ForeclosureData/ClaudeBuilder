import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const revalidate = 300;

/** Small, public, cacheable list — powers the homepage/nav county search and mobile's county picker. */
export async function GET() {
  const counties = await prisma.county.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { slug: true, name: true, state: true, isActive: true },
  });
  return NextResponse.json(counties);
}
