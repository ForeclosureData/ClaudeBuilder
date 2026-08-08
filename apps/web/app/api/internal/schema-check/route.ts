import { NextResponse } from "next/server";

/**
 * Retired after confirming the ManualReviewReason.CAD_OWNER_CONFLICT enum
 * value was already present in production (this time the build-time
 * `db:push` step did reach the database) and that manualReviewTask row
 * counts were unchanged before and after the (no-op) migration call. Same
 * neutering approach as the other temporary routes in this directory: this
 * site's upload-based deploy doesn't reliably drop a route on file
 * deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
