import { NextResponse } from "next/server";

/**
 * Retired after use: verified the Phase 1 extraction backfill (2026-08-09)
 * -- pre-backfill state, post-backfill state, and the 49 AuditLog entries
 * it wrote. See docs/DEPLOYMENT.md's "Phase 1: Extraction backfill" section
 * for the findings. No writes. Same neutering pattern as this directory's
 * other temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
