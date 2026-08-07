import { NextResponse } from "next/server";

/**
 * Retired after computing and reporting the 25-notice bounded production
 * run's property-resolution/valuation/publication metrics (GH Actions run
 * 31223343595). Same neutering approach as the other temporary routes in
 * this directory: this site's upload-based deploy doesn't reliably drop a
 * route on file deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
