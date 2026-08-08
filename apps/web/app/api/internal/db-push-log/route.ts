import { NextResponse } from "next/server";

/**
 * Retired: the build no longer captures db:push output to a file for
 * out-of-band reading -- a db:push failure now fails the build outright
 * (visible directly in Netlify's own build log), so this workaround is no
 * longer needed. Same neutering approach as this directory's other
 * temporary diagnostic routes.
 */
export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
