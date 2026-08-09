/**
 * GitHub Actions entrypoint for the Hidalgo foreclosure-notice ingestion
 * pipeline (.github/workflows/hidalgo-ingestion.yml). Runs on a full
 * Ubuntu runner rather than Netlify Functions specifically so it can use
 * local Tesseract OCR (tesseract.js) -- see
 * packages/county-adapters/src/hidalgo/ocr.ts for why that doesn't fit in
 * a Lambda bundle. Netlify keeps the web app, auth, and lightweight API
 * routes; this script owns the CPU-heavy, infrequent, non-interactive
 * ingestion work: discover -> download -> render (MuPDF) -> barcode
 * boundary detection -> split -> OCR -> deterministic extraction ->
 * Claude fallback (bounded) -> property resolution -> persistence.
 *
 * Two modes, selected by INGEST_MODE:
 *  - "dry-run" (default): discovers the latest bundle, downloads it,
 *    renders/scans/OCRs/extracts fields -- but makes NO database writes
 *    and NO Anthropic API calls (a hard-disabled budget guard, not just an
 *    unset key). Validates the environment end-to-end before touching
 *    production data.
 *  - "production": runs the real ingestForeclosureNotices() pipeline,
 *    which persists to the database and may call Claude within the
 *    configured run-level budget caps. Still bounded by
 *    MAX_BUNDLES/MAX_NOTICES_PER_BUNDLE -- unbounded is a deliberate
 *    separate decision, not this script's default.
 *
 * Logging deliberately prints only counts/rates/booleans/public filing
 * numbers -- never noticeText, names, or addresses -- and scrubs anything
 * that looks like a database connection string or API key out of any
 * caught error message before printing it.
 */
import { hidalgoAdapter, discoverPropertySalePostings, splitHidalgoBundle } from "@foreclosuredata/county-adapters";
import { ocrPages, shutdownOcrWorker } from "@foreclosuredata/county-adapters/src/hidalgo/ocr.ts";
import { runExtractionPipeline, normalizeCountyFilingNumber } from "@foreclosuredata/foreclosure-core";
import { ingestForeclosureNotices } from "../lib/ingestion/ingestForeclosureNotices.ts";
import { prisma } from "@foreclosuredata/database";

const MODE = (process.env.INGEST_MODE ?? "dry-run").toLowerCase();
const MAX_BUNDLES = intEnv("MAX_BUNDLES", 1);
const MAX_NOTICES_PER_BUNDLE = intEnv("MAX_NOTICES_PER_BUNDLE", 5);
const MAX_AI_FALLBACK_CALLS_PER_RUN = intEnv("MAX_AI_FALLBACK_CALLS_PER_RUN", 10);
const MAX_AI_COST_PER_RUN_USD = floatEnv("MAX_AI_COST_PER_RUN_USD", 1.0);
const BARCODE_SCAN_SCALE = floatEnv("BARCODE_SCAN_SCALE", 3.0);
const OCR_CONFIDENCE_THRESHOLD = floatEnv("OCR_CONFIDENCE_THRESHOLD", 70);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Strips anything that looks like a DB connection string or an API key out of a message before it's ever printed. */
function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"')]+/gi, "[REDACTED_DB_URL]")
    .replace(/sk-ant-[A-Za-z0-9_\-]+/gi, "[REDACTED_API_KEY]");
}

const NEVER_SPEND_BUDGET = {
  async hasHeadroom(): Promise<boolean> {
    return false;
  },
  async recordSpend(): Promise<void> {
    // unreachable — hasHeadroom always refuses, so extractWithAI never runs.
  },
};

async function runDryRun(): Promise<void> {
  console.log(`Mode: dry-run (no database writes, no Anthropic API calls)`);
  console.log(`Bounds: maxNoticesPerBundle=${MAX_NOTICES_PER_BUNDLE}, barcodeScanScale=${BARCODE_SCAN_SCALE}`);

  const postings = await discoverPropertySalePostings();
  console.log(`Bundle discovered: ${postings.length > 0 ? "yes" : "no"} (${postings.length} posting(s) found)`);
  if (postings.length === 0) {
    console.log("No postings found; nothing to validate.");
    return;
  }

  const latest = postings[0]!;
  console.log(`Using posting: ${latest.documentId} (posted ${latest.postedDate?.toISOString() ?? "unknown date"})`);

  const downloaded = await hidalgoAdapter.downloadNotice({
    externalId: latest.documentId,
    countySourceKey: "hidalgo",
    sourceUrl: latest.pageUrl,
    documentUrl: latest.documentUrl,
    filename: latest.filename,
  });

  const { createHash } = await import("node:crypto");
  const bundleSha256 = createHash("sha256").update(downloaded.fileBuffer).digest("hex");
  console.log(`Bundle hash (sha256): ${bundleSha256}`);
  console.log(`Bundle size: ${(downloaded.fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  const result = await splitHidalgoBundle(downloaded.fileBuffer, {
    maxNotices: MAX_NOTICES_PER_BUNDLE,
    ocr: ocrPages,
    ocrConfidenceThreshold: OCR_CONFIDENCE_THRESHOLD,
    barcodeScanScale: BARCODE_SCAN_SCALE,
    // No apiKey passed -- if OCR confidence is too low for any sampled
    // notice, splitHidalgoBundle stops early rather than silently calling
    // Claude, which is exactly right for a dry run.
  });

  console.log(`Total PDF pages: ${result.totalPages}`);
  console.log(`Pages scanned/consumed this run: ${result.pagesConsumed}`);
  console.log(`Boundaries detected: ${result.barcodesDetected}`);
  console.log(`Notices split: ${result.notices.length}`);
  if (result.stoppedEarly) console.log(`Stopped early: ${result.stopReason}`);

  let ocrSuccessCount = 0;
  let ocrConfidenceSum = 0;
  let ocrConfidenceCount = 0;
  let deterministicOnlyCount = 0;
  let wouldNeedAiFallbackCount = 0;
  const filingNumbersInOrder: Array<string | null> = [];

  for (const notice of result.notices) {
    if (notice.contentSource === "ocr") ocrSuccessCount++;
    if (typeof notice.ocrConfidence === "number") {
      ocrConfidenceSum += notice.ocrConfidence;
      ocrConfidenceCount++;
    }
    filingNumbersInOrder.push(normalizeCountyFilingNumber(notice.documentNumber));

    const pipelineResult = await runExtractionPipeline(notice.noticeText, NEVER_SPEND_BUDGET);
    if (pipelineResult.needsManualReview) wouldNeedAiFallbackCount++;
    else deterministicOnlyCount++;
  }

  console.log(`\nOCR success rate: ${result.notices.length ? ((ocrSuccessCount / result.notices.length) * 100).toFixed(0) : "n/a"}%`);
  console.log(`Average OCR confidence: ${ocrConfidenceCount ? (ocrConfidenceSum / ocrConfidenceCount).toFixed(1) : "n/a"}`);
  console.log(`Deterministically extracted (no AI needed): ${deterministicOnlyCount}`);
  console.log(`Would require Claude field-extraction fallback: ${wouldNeedAiFallbackCount}`);
  console.log(`Anthropic cost: $0.00 (dry run never calls the API)`);

  // Read-only DB lookup (no writes) -- reports which of the notices found
  // in this scan (in bundle-page order, exactly what a bounded production
  // run would process next) are already-ingested vs genuinely new, so a
  // selection can be proven non-overlapping BEFORE any production run.
  const distinctFilingNumbers = [...new Set(filingNumbersInOrder.filter((n): n is string => n !== null))];
  const existingCases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: distinctFilingNumbers }, archivedAt: null },
    select: { countyFilingNumber: true },
  });
  const alreadyIngested = new Set(existingCases.map((c) => c.countyFilingNumber));
  const newFilingNumbers = distinctFilingNumbers.filter((fn) => !alreadyIngested.has(fn));

  console.log(`\n=== Filing-number identity check (read-only, no writes) ===`);
  console.log(`Filing numbers found in this scan (in bundle-page order): ${JSON.stringify(filingNumbersInOrder)}`);
  console.log(`Distinct non-null filing numbers: ${distinctFilingNumbers.length}`);
  console.log(`Already ingested (would be skipped as duplicates): ${alreadyIngested.size} -> ${JSON.stringify([...alreadyIngested])}`);
  console.log(`Genuinely new (not yet in the database): ${newFilingNumbers.length} -> ${JSON.stringify(newFilingNumbers)}`);

  await shutdownOcrWorker();
  await prisma.$disconnect();
}

async function runProduction(): Promise<void> {
  console.log(`Mode: production (real database writes; Claude fallback enabled within run-level caps)`);
  console.log(
    `Bounds: maxBundles=${MAX_BUNDLES}, maxNoticesPerBundle=${MAX_NOTICES_PER_BUNDLE}, ` +
      `maxAiFallbackCallsPerRun=${MAX_AI_FALLBACK_CALLS_PER_RUN}, maxAiCostPerRunUsd=${MAX_AI_COST_PER_RUN_USD}, ` +
      `barcodeScanScale=${BARCODE_SCAN_SCALE}`,
  );

  const summary = await ingestForeclosureNotices("hidalgo-tx", hidalgoAdapter, {
    maxBundles: MAX_BUNDLES,
    maxNoticesPerBundle: MAX_NOTICES_PER_BUNDLE,
    ocr: ocrPages,
    ocrConfidenceThreshold: OCR_CONFIDENCE_THRESHOLD,
    barcodeScanScale: BARCODE_SCAN_SCALE,
    maxAiFallbackCallsPerRun: MAX_AI_FALLBACK_CALLS_PER_RUN,
    maxAiCostPerRunCents: Math.round(MAX_AI_COST_PER_RUN_USD * 100),
  });

  console.log(`\n=== Run summary ===`);
  console.log(`Bundles discovered: ${summary.bundlesDiscovered}`);
  console.log(`Bundles processed: ${summary.bundlesProcessed}`);
  console.log(`Bundles skipped (already ingested, unchanged): ${summary.bundlesSkippedUnchanged}`);
  console.log(`Bundles failed: ${summary.bundlesFailed}`);
  console.log(`Notices split: ${summary.noticesSplit}`);
  console.log(`Notices OCR'd successfully: ${summary.noticesOcrSuccess}`);
  console.log(`Notices requiring content Claude-vision fallback: ${summary.noticesContentClaudeFallback}`);
  console.log(`Average OCR confidence: ${summary.averageOcrConfidence?.toFixed(1) ?? "n/a"}`);
  console.log(`Notices flagged low-confidence transcription: ${summary.noticesTranscriptionLowConfidence}`);
  console.log(`Notices extracted: ${summary.noticesExtracted}`);
  console.log(`Field-extraction Claude fallback calls: ${summary.aiFallbackCallCount}${summary.aiBudgetExhausted ? " (run-level AI budget cap reached — remaining ambiguous fields routed to manual review)" : ""}`);
  console.log(`Anthropic cost: $${(summary.aiCostCents / 100).toFixed(4)}`);
  console.log(`Records created (new): ${summary.noticesPersisted}`);
  console.log(`Duplicates skipped: ${summary.noticesDuplicate}`);
  console.log(`Records sent to manual review: ${summary.noticesRequiringManualReview}`);
  console.log(`Notices failed (unexpected error, skipped): ${summary.noticesFailed}`);
  console.log(`Total errors logged (bundle + notice failures): ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    console.log(`\nErrors:`);
    for (const err of summary.errors) console.log(`  - ${redact(err)}`);
  }

  await shutdownOcrWorker();
}

async function main() {
  const startedAt = Date.now();
  console.log(`=== Hidalgo ingestion run (${new Date().toISOString()}) ===`);

  try {
    if (MODE === "dry-run") {
      await runDryRun();
    } else if (MODE === "production") {
      await runProduction();
    } else {
      throw new Error(`Unknown INGEST_MODE "${MODE}" — expected "dry-run" or "production"`);
    }
  } catch (err) {
    const message = err instanceof Error ? redact(err.message) : redact(String(err));
    console.error(`\nFATAL: ${message}`);
    await shutdownOcrWorker().catch(() => {});
    process.exitCode = 1;
    return;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`\nTotal processing time: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`(GitHub Actions billed minutes: see this run's duration in the Actions UI.)`);
}

main();
