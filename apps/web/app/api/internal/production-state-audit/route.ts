import { NextResponse } from "next/server";

/**
 * Retired after the 2026-08-08 production-safety review confirmed
 * production state (classification B: 82-record seed baseline, zero
 * duplicates) and the composite unique constraint was re-enabled. See
 * docs/DEPLOYMENT.md's incident writeup for the findings this route
 * produced. Same neutering approach as this directory's other temporary
 * diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
