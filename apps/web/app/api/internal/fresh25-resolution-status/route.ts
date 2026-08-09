import { NextResponse } from "next/server";

/**
 * Retired after use: supplied the property-resolution/valuation state used
 * to recompute investor-completeness for the extraction repair's final
 * report -- see docs/DEPLOYMENT.md's "Extraction/AI-fallback repair"
 * section. No writes. Same neutering pattern as this directory's other
 * temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
