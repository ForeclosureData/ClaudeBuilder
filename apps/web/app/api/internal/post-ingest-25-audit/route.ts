import { NextResponse } from "next/server";

/**
 * Retired after use: produced the full-detail data for the fresh
 * 25-notice production ingestion test's report (2026-08-09), including
 * the 100% manual verification of all 7 CAD-confirmed parcels -- see
 * docs/DEPLOYMENT.md's "Fresh 25-notice production ingestion test"
 * section for the findings. No writes. Same neutering approach as this
 * directory's other temporary diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
