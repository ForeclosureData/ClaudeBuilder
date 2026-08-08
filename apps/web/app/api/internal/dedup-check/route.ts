import { NextResponse } from "next/server";

/**
 * Retired after confirming duplicate ForeclosureCase rows exist in
 * production (164 SourceDocument rows for only 131 distinct county filing
 * numbers -- 24 filing numbers with 2-5 rows each) caused by a dedup-hash
 * design flaw (see ingestForeclosureNotices.ts's processSingleNotice
 * dedupHash comment for the fix). Same neutering approach as this
 * directory's other temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
