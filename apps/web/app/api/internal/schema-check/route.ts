import { NextResponse } from "next/server";

/**
 * Retired after confirming the AppraisalValueHistory.certified column was
 * applied to production (nullable, additive) and that existing row counts
 * (foreclosureCase/property/sourceDocument) were unchanged before and
 * after. Same neutering approach as the other temporary routes in this
 * directory: this site's upload-based deploy doesn't reliably drop a route
 * on file deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
