import { NextResponse } from "next/server";

/**
 * Retired after pulling the 25 notices' raw OCR text once to check which
 * real principal-amount phrasings appear in the sample before extending
 * texasTemplates.ts's patterns, and to source sanitized regression-test
 * fixtures (extraction repair task, 2026-08-09). No writes. Same
 * neutering pattern as this directory's other temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
