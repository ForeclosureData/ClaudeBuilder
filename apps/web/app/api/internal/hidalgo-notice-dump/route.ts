import { NextResponse } from "next/server";

/**
 * Retired after pulling the 5 real notices' raw OCR text once to tune the
 * deterministic grantor/borrower parser against real Hidalgo phrasing.
 * Same neutering pattern as render-debug: this site's upload-based deploy
 * doesn't reliably drop a route on file deletion, so an always-410 stub is
 * used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
