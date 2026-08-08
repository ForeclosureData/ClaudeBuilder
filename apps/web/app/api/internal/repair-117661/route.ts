import { NextResponse } from "next/server";

/**
 * Retired after successfully repairing document 117661's wrong CAD
 * enrichment: verified the Property wasn't shared by another case, reverted
 * the CAD-derived fields to the notice's own legal description, superseded
 * the wrong candidate's isSelected flag, wrote an AuditLog row, and opened
 * a manual-review task. Same neutering approach as this directory's other
 * temporary routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
