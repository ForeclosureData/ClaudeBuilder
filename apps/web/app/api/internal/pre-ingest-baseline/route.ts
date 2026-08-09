import { NextResponse } from "next/server";

/**
 * Retired after use: captured the pre-run snapshot for the fresh
 * 25-notice production ingestion test (2026-08-09) -- see
 * docs/DEPLOYMENT.md's "Fresh 25-notice production ingestion test"
 * section for the findings. No writes. Same neutering approach as this
 * directory's other temporary diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
