import { NextResponse } from "next/server";

/**
 * Retired after the 2026-08-08 recovery-closure verification confirmed:
 * (1) the orphaned 117661-repair AuditLog entry was annotated with closure
 * context (id d5afa9fe-d9fc-479b-8dcd-fd50a344c1f0, original entry never
 * modified/deleted), (2) all 13 integrity checks against the 82-record
 * baseline passed, including a real DB-level re-confirmation that
 * foreclosure_cases_county_id_county_filing_number_key exists as a unique
 * index. See docs/DEPLOYMENT.md's incident closure section for the
 * findings this route produced. Same neutering approach as this
 * directory's other temporary diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
