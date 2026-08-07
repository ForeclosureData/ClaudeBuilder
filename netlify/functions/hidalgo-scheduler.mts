import type { Config } from "@netlify/functions";

/**
 * Deliberately thin — this scheduled function has no dependency on the
 * heavy Hidalgo ingestion code (PDF rendering, canvas, Claude vision calls)
 * on purpose, so its own bundling stays trivial and reliable. All it does
 * is call the real work at /api/internal/ingest-hidalgo inside the already
 *-deployed Next.js app, authenticated with a shared secret. That route is
 * itself a no-op unless HIDALGO_LIVE_INGESTION_ENABLED=true.
 */
export default async () => {
  const siteUrl = process.env.URL ?? process.env.DEPLOY_URL;
  const secret = process.env.INTERNAL_INGEST_SECRET;
  if (!siteUrl || !secret) {
    console.error("hidalgo-scheduler: missing URL or INTERNAL_INGEST_SECRET; skipping.");
    return;
  }

  const res = await fetch(`${siteUrl}/api/internal/ingest-hidalgo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`hidalgo-scheduler: ${res.status} ${body}`);
};

export const config: Config = {
  schedule: "0 */6 * * *",
};
