import { NextResponse } from "next/server";
import { dbPushLog } from "@/lib/generated/dbPushDebug";

/**
 * Diagnostic-only: surfaces the captured stdout/stderr of the most recent
 * production build's `prisma db push` run, since there's no other way to
 * read Netlify's build log from here. See netlify.toml's build command for
 * where dbPushDebug.ts gets (re)generated. Retired to a 410 stub once the
 * db-push investigation concludes, same as this directory's other temporary
 * diagnostic routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ log: dbPushLog });
}
