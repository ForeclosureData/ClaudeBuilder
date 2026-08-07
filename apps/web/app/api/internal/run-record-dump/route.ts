import { NextResponse } from "next/server";

/**
 * Retired after pulling the 25-notice run's rawText/manual-review/
 * resolution state once to classify manual-review reasons and mine real
 * Hidalgo lender/mortgagee/beneficiary phrasing for the new deterministic
 * extractor. Same neutering approach as the other temporary routes in
 * this directory: this site's upload-based deploy doesn't reliably drop a
 * route on file deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
