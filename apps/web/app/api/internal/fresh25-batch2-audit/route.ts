import { NextResponse } from "next/server";

/**
 * Retired after use: produced the full audit data for the Phase 2 report
 * (second fresh 25-notice generalization batch, 2026-08-09) -- see
 * docs/DEPLOYMENT.md's "Phase 2: Second fresh 25-notice generalization
 * batch" section for the findings, including the 100% manual verification
 * of every CAD-confirmed parcel and every AI-recovered borrower/principal.
 * No writes. Same neutering pattern as this directory's other temporary
 * routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
