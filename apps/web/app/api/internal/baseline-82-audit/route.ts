import { NextResponse } from "next/server";

/**
 * Retired after use: produced the full-82-baseline audit numbers for the
 * CAD regeneration effort's final report (10-case pilot + HID-118198
 * closeout + 72-case bulk run). See docs/DEPLOYMENT.md's "Full 82-case
 * baseline regeneration report" section for the findings. Same
 * neutering approach as this directory's other temporary diagnostic
 * routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
