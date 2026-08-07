import { NextResponse } from "next/server";

/**
 * Retired after confirming (via a real rendered PNG fetched from this
 * runtime) that page rendering produces a blank image in the deployed
 * Lambda, unlike local/sandbox testing -- see the conversation for
 * details and next steps. Same neutering approach as the other temporary
 * routes: this site's upload-based deploy doesn't reliably drop a route
 * on file deletion, so an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
