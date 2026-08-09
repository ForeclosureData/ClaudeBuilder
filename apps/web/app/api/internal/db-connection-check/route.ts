import { NextResponse } from "next/server";

/**
 * Retired after confirming Netlify's runtime DATABASE_URL/DIRECT_URL both
 * resolve to the real production database (Netlify DB, Neon-backed,
 * ep-fancy-shape-ay1029j3...db.netlify.com) -- the same database GitHub
 * Actions' DATABASE_URL secret reaches (cross-checked via the real
 * HID-117914/HID-117888 backfilled values), and confirming the
 * PossibleDuplicateNoticeLink row for HID-117729/HID-117731 persisted
 * correctly with stable row counts and no ProcessingJob started. See
 * docs/DEPLOYMENT.md's "Database connection architecture" section for the
 * full findings. Same neutering approach as this directory's other
 * temporary diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
