import { NextResponse } from "next/server";

/**
 * Retired after use: selected the 10-case sample for the 2026-08-08 CAD
 * regeneration pilot (see docs/DEPLOYMENT.md's pilot report) and was
 * re-queried once more after the pilot ran to confirm zero
 * notice-transcribed Property fields (address/subdivision/lot/block/
 * addressResolutionMethod) changed for any of the 82 baseline cases.
 * Same neutering approach as this directory's other temporary diagnostic
 * routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
