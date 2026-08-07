import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { hidalgoAdapter } from "@foreclosuredata/county-adapters";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { ingestForeclosureNotices } from "@/lib/ingestion/ingestForeclosureNotices";

export const maxDuration = 300;

/**
 * Admin-only, manually-triggered Hidalgo ingestion run — used for
 * supervised testing (bounded via maxBundles/maxNoticesPerBundle) rather
 * than the unattended 6-hour poll, which lives at
 * /api/internal/ingest-hidalgo and only runs when
 * HIDALGO_LIVE_INGESTION_ENABLED=true. This route ignores that flag on
 * purpose — a logged-in admin explicitly running a bounded test is
 * supervised, not "automatic publishing."
 */
export async function POST(request: Request) {
  const profileId = await getCurrentProfileId();
  if (!profileId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile || profile.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const maxBundles = typeof body.maxBundles === "number" ? body.maxBundles : 1;
  const maxNoticesPerBundle = typeof body.maxNoticesPerBundle === "number" ? body.maxNoticesPerBundle : 5;

  const summary = await ingestForeclosureNotices("hidalgo", hidalgoAdapter, { maxBundles, maxNoticesPerBundle });

  return NextResponse.json(summary);
}
