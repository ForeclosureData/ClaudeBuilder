import { NextResponse } from "next/server";

/**
 * Retired again after a second round of testing (against the current
 * ProdigyCAD-hosted portal — see the conversation for results). Same
 * neutering approach as before: this Netlify site's upload-based deploy
 * reuses previously-uploaded function bundles for files it doesn't detect
 * as changed, so a plain file deletion doesn't reliably stop a route from
 * being served — an always-410 stub does.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
