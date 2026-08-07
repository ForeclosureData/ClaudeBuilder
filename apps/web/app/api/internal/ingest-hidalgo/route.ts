import { NextResponse } from "next/server";
import { hidalgoAdapter } from "@foreclosuredata/county-adapters";
import { ingestForeclosureNotices } from "@/lib/ingestion/ingestForeclosureNotices";

export const maxDuration = 300;

/**
 * Called by the Netlify scheduled function (netlify/functions/hidalgo-scheduler)
 * every 6 hours — not reachable without INTERNAL_INGEST_SECRET.
 *
 * Two modes, both requiring the secret (nobody but the scheduler and
 * whoever holds the secret can reach this at all):
 *  - No body / no explicit bounds (how the scheduler calls it): a full,
 *    unbounded run, gated behind HIDALGO_LIVE_INGESTION_ENABLED=true. That
 *    flag stays false until a supervised test run has demonstrated
 *    acceptable accuracy — the "automatic publishing stays disabled until
 *    accuracy is demonstrated" product requirement.
 *  - Explicit maxBundles/maxNoticesPerBundle in the body: a bounded,
 *    supervised test run (someone who holds the secret deliberately
 *    scoped it), which runs regardless of the enabled flag — equivalent to
 *    the admin-session-gated /api/admin/ingest-hidalgo route, provided for
 *    cases where a bounded curl-based test is easier than a browser
 *    session (used for this feature's initial live verification).
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const hasExplicitBounds = typeof body.maxBundles === "number" || typeof body.maxNoticesPerBundle === "number";

  if (!hasExplicitBounds && process.env.HIDALGO_LIVE_INGESTION_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "HIDALGO_LIVE_INGESTION_ENABLED is not \"true\"" });
  }

  const summary = await ingestForeclosureNotices("hidalgo-tx", hidalgoAdapter, {
    maxBundles: body.maxBundles,
    maxNoticesPerBundle: body.maxNoticesPerBundle,
  });
  return NextResponse.json(summary);
}
