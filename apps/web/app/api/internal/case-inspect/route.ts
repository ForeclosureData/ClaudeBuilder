import { NextResponse } from "next/server";

/**
 * Retired after supplying the raw notice text and persisted state used for
 * the 117643/117661 investigation and repair, and the full 24-record
 * post-fix re-score for the CAD-matching cleanup pass. Same neutering
 * approach as this directory's other temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
