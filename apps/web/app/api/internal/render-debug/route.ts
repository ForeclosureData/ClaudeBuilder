import { NextResponse } from "next/server";

/**
 * Retired after confirming the MuPDF rendering rewrite produces a real,
 * fully legible page from the deployed runtime (byte-identical to the
 * sandbox render) — see the conversation for the confirming image. Same
 * neutering approach as the other temporary routes: this site's
 * upload-based deploy doesn't reliably drop a route on file deletion, so
 * an always-410 stub is used instead.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
