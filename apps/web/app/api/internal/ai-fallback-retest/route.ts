import { NextResponse } from "next/server";

/**
 * Retired: this route was meant to verify the extractWithAI max_tokens fix
 * (2000 -> 4096) against the 25-notice run's cached rawText with no new
 * ingestion, but ANTHROPIC_API_KEY isn't configured on the Netlify site
 * (it's only present as a GitHub Actions secret used by the bounded
 * ingestion workflow), so the route could never make a real call from here
 * -- confirmed zero cost was possible (the missing-key branch returns
 * before any network call) before removing it. The fix itself is still
 * live in extractWithAI.ts; verifying it in practice requires an actual
 * bounded GH Actions ingestion run, which was intentionally not
 * re-triggered pending review. Same neutering pattern as this directory's
 * other temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
