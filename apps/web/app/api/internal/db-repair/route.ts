import { NextResponse } from "next/server";

/**
 * Retired. This was a temporary, one-time schema-drift repair (already
 * run — production is confirmed in sync, see the conversation) that had
 * to be neutered in place rather than deleted: this Netlify site's
 * upload-based deploy appears to reuse previously-uploaded function
 * bundles for files it doesn't detect as changed, so a plain file
 * deletion did not actually remove the route from what's served. Kept as
 * an always-410 stub so whatever gets served here can never run raw SQL
 * again.
 */
export async function POST() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
