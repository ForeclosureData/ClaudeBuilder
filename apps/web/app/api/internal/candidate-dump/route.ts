import { NextResponse } from "next/server";

/**
 * Retired after pulling the 24-record production run's candidate/
 * resolution-attempt data for the CAD-matching-improvement phase's
 * failure-mode classification and cached-pool re-scoring analysis. Same
 * neutering approach as the other temporary routes in this directory: this
 * site's upload-based deploy doesn't reliably drop a route on file
 * deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
