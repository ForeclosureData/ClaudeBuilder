import { NextResponse } from "next/server";

/**
 * Retired. This was a temporary, one-time diagnostic (already run against
 * propaccess.hidalgoad.org / esearch.hidalgoad.org — see the conversation
 * for results) that had to be neutered in place rather than deleted: this
 * Netlify site's upload-based deploy appears to reuse previously-uploaded
 * function bundles for files it doesn't detect as changed, so a plain file
 * deletion did not actually remove the route from what's served. Kept as
 * an always-410 stub so whatever gets served here can never run the old
 * diagnostic logic again.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
