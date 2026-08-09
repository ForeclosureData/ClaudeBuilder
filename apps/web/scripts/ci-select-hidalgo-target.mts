/**
 * GitHub Actions entrypoint for pre-flight target-notice selection.
 *
 * Purpose: prove, BEFORE any AI/Anthropic spend and before any production
 * ingestion run, that a specific set of filing numbers is (a) real -- found
 * via a real barcode scan of the actual bundle PDF -- and (b) genuinely new
 * -- not already present in ForeclosureCase -- so a bounded batch can be
 * capped at an exact count with proof, not a hopeful estimate.
 *
 * Makes ZERO database writes and ZERO Anthropic API calls. The only network
 * fetch is downloading the bundle PDF itself (same as dry-run mode). Notice
 * boundaries and filing numbers come from the cover-sheet CODE-39 barcode
 * scan (packages/county-adapters/src/hidalgo/barcodeSplit.ts +
 * pdfRender.ts) -- the same deterministic, local-only mechanism
 * splitHidalgoBundle uses internally, called here directly so this script
 * never runs OCR or Claude vision at all. It reads every page's barcode
 * across the whole bundle, which is more pages than a bounded ingestion run
 * would OCR, but barcode scanning alone costs nothing but CPU time.
 *
 * Env vars:
 *  - TARGET_COUNT (default 50): how many new filing numbers to select.
 *  - BARCODE_SCAN_SCALE (default 3.0): same as ci-ingest-hidalgo.mts.
 *
 * Output: a full read-only report to stdout, plus
 * apps/web/scripts/hidalgo-target-selection.json containing the selected
 * filing numbers and the exact maxNoticesPerBundle window needed to reach
 * them, for the next step (the bounded production run) to consume.
 *
 * IMPORTANT non-overlap gap this script closes: the original 82 real
 * Hidalgo cases (packages/database/prisma/hidalgo-real-cases.ts, seeded
 * once early in this project's history) were written to production by an
 * earlier revision of prisma/seed.ts that did not populate
 * ForeclosureCase.countyFilingNumber -- confirmed by the live count
 * (82 seeded + N pipeline-ingested rows == total ForeclosureCase count,
 * but only N rows have a non-null countyFilingNumber). A DB-only "already
 * ingested" check is therefore blind to those 82 legacy rows and could
 * select a filing number that's actually already represented in the
 * database under a different (seed) code path, producing a real duplicate
 * ForeclosureCase on ingestion. This script closes that gap by ALSO
 * excluding every docNumber in hidalgo-real-cases.ts directly from the
 * source file, independent of what the database's countyFilingNumber
 * column currently says.
 */
import { writeFile } from "node:fs/promises";
import { hidalgoAdapter, discoverPropertySalePostings } from "@foreclosuredata/county-adapters";
import { loadPdf } from "@foreclosuredata/county-adapters/src/hidalgo/pdfRender.ts";
import { detectDocumentBoundaries, boundariesToNoticeRanges } from "@foreclosuredata/county-adapters/src/hidalgo/barcodeSplit.ts";
import { normalizeCountyFilingNumber } from "@foreclosuredata/foreclosure-core";
import { prisma } from "@foreclosuredata/database";
import { realHidalgoCases } from "../../../packages/database/prisma/hidalgo-real-cases.ts";

const TARGET_COUNT = intEnv("TARGET_COUNT", 50);
const BARCODE_SCAN_SCALE = floatEnv("BARCODE_SCAN_SCALE", 3.0);
const OUTPUT_PATH = new URL("./hidalgo-target-selection.json", import.meta.url);

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

async function main() {
  console.log(`=== Hidalgo pre-flight target selection (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero database writes, zero Anthropic calls, barcode scan only)`);
  console.log(`Target count: ${TARGET_COUNT} new filing numbers\n`);

  // Step 1: current production state, before touching anything.
  const totalCaseCount = await prisma.foreclosureCase.count({ where: { archivedAt: null } });
  const existingRows = await prisma.foreclosureCase.findMany({
    where: { archivedAt: null },
    select: { countyFilingNumber: true },
  });
  const existingFilingNumbers = new Set(existingRows.map((r) => r.countyFilingNumber).filter((n): n is string => n !== null));

  // Legacy-seed exclusion (see module comment): sourced from the seed data
  // file directly, not the database, because the 82 originally-seeded real
  // Hidalgo cases are known to have a null countyFilingNumber column in the
  // live database and would otherwise be invisible to the check above.
  const legacySeedFilingNumbers = new Set(
    realHidalgoCases.map((c) => normalizeCountyFilingNumber(c.docNumber)).filter((n): n is string => n !== null),
  );

  console.log(`=== Current production state ===`);
  console.log(`Unique ForeclosureCase rows (non-archived): ${totalCaseCount}`);
  console.log(`Unique non-null county filing numbers currently ingested: ${existingFilingNumbers.size}`);
  console.log(`Legacy seed dataset filing numbers (excluded regardless of DB column state): ${legacySeedFilingNumbers.size}`);

  // Step 2: discover bundle posting(s) -- same discovery call the dry-run
  // and production modes use.
  const postings = await discoverPropertySalePostings();
  console.log(`\n=== Bundle discovery ===`);
  console.log(`Postings found: ${postings.length}`);
  if (postings.length === 0) {
    console.log("No postings found; nothing to select. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // Selection accumulates across postings in discovery order until
  // TARGET_COUNT new filing numbers are found, or postings are exhausted.
  // In the current known state there is exactly one live bundle posting
  // (the ~282-notice monthly bundle), so this loop is expected to run once.
  const selected: string[] = [];
  const scannedInOrder: Array<{ documentNumber: string | null; normalized: string | null; postingId: string }> = [];
  const legacySeedMatchesSkipped: string[] = [];
  let windowSizeInLatestBundle = 0; // how many notices (in page order) of the LAST scanned posting must be split to reach the last selected filing number
  let bundleNoticeCountForCoverage: number | null = null;

  for (const posting of postings) {
    if (selected.length >= TARGET_COUNT) break;

    console.log(`\n--- Scanning posting ${posting.documentId} (posted ${posting.postedDate?.toISOString() ?? "unknown date"}) ---`);
    const downloaded = await hidalgoAdapter.downloadNotice({
      externalId: posting.documentId,
      countySourceKey: "hidalgo",
      sourceUrl: posting.pageUrl,
      documentUrl: posting.documentUrl,
      filename: posting.filename,
    });

    const { createHash } = await import("node:crypto");
    const bundleSha256 = createHash("sha256").update(downloaded.fileBuffer).digest("hex");
    console.log(`Bundle hash (sha256): ${bundleSha256}`);
    console.log(`Bundle size: ${(downloaded.fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

    const pdf = await loadPdf(downloaded.fileBuffer);
    console.log(`Total PDF pages: ${pdf.numPages}`);

    const scan = await detectDocumentBoundaries({
      numPages: pdf.numPages,
      scanPageForBarcode: async (pageNumber) => (await pdf.scanPageForBarcodes(pageNumber, BARCODE_SCAN_SCALE))[0] ?? null,
    });
    console.log(`Cover-sheet barcodes detected: ${scan.barcodesFound}`);

    const ranges = boundariesToNoticeRanges(scan.boundaries, pdf.numPages);
    bundleNoticeCountForCoverage = ranges.length;

    let windowCursor = 0;
    for (const range of ranges) {
      windowCursor++;
      const normalized = normalizeCountyFilingNumber(range.documentNumber);
      scannedInOrder.push({ documentNumber: range.documentNumber, normalized, postingId: posting.documentId });

      if (selected.length >= TARGET_COUNT) continue; // keep scanning to report full bundle stats, but stop selecting

      if (!normalized || existingFilingNumbers.has(normalized) || selected.includes(normalized)) continue;

      if (legacySeedFilingNumbers.has(normalized)) {
        legacySeedMatchesSkipped.push(normalized);
        continue;
      }

      selected.push(normalized);
      windowSizeInLatestBundle = windowCursor;
    }
  }

  const distinctScanned = new Set(scannedInOrder.map((s) => s.normalized).filter((n): n is string => n !== null));
  const alreadyIngestedInScan = [...distinctScanned].filter((n) => existingFilingNumbers.has(n));
  const missingBarcode = scannedInOrder.filter((s) => s.normalized === null).length;

  console.log(`\n=== Scan summary ===`);
  console.log(`Total notices scanned across bundle(s) (barcode boundaries): ${scannedInOrder.length}`);
  console.log(`Distinct non-null normalized filing numbers found: ${distinctScanned.size}`);
  console.log(`Notices with unreadable/missing filing-number barcode: ${missingBarcode}`);
  console.log(`Already-ingested filing numbers found in scan: ${alreadyIngestedInScan.length}`);
  console.log(`Legacy seed-dataset filing numbers skipped (matched hidalgo-real-cases.ts, not DB): ${legacySeedMatchesSkipped.length}${legacySeedMatchesSkipped.length ? " -> " + JSON.stringify(legacySeedMatchesSkipped) : ""}`);
  console.log(`Genuinely new filing numbers found in scan: ${distinctScanned.size - alreadyIngestedInScan.length - legacySeedMatchesSkipped.length}`);

  console.log(`\n=== Selection ===`);
  console.log(`Selected ${selected.length} of ${TARGET_COUNT} requested new filing numbers.`);
  if (selected.length < TARGET_COUNT) {
    console.log(`WARNING: fewer than ${TARGET_COUNT} new filing numbers were available across all discovered postings. Do not pad the selection -- report this shortfall as-is.`);
  }
  console.log(`Window: the last selected notice is the #${windowSizeInLatestBundle} notice (in page order) of the most recently scanned bundle.`);
  console.log(`Recommended maxNoticesPerBundle for the production run: ${windowSizeInLatestBundle} (splits exactly through the last selected notice, no further).`);
  console.log(`Selected filing numbers (in bundle page order):\n${JSON.stringify(selected, null, 2)}`);

  // Step 3: explicit, separate non-overlap proof -- re-query the DB for
  // exactly the selected set, right before any external/AI spend would
  // happen in a later step. This is intentionally redundant with the
  // exclusion check above (which already guarantees no overlap by
  // construction) because the user's requirement is to PROVE it as a
  // distinct verification step, not just to rely on the selection logic
  // being correct.
  const overlapCheck = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: selected }, archivedAt: null },
    select: { countyFilingNumber: true },
  });
  console.log(`\n=== Non-overlap proof (explicit re-check against production DB) ===`);
  console.log(`Selected filing numbers re-queried against ForeclosureCase: ${selected.length}`);
  console.log(`Matches found (must be 0): ${overlapCheck.length}`);
  if (overlapCheck.length > 0) {
    console.error(`FATAL: non-overlap proof FAILED -- ${overlapCheck.length} of the selected filing numbers are already ingested: ${JSON.stringify(overlapCheck.map((c) => c.countyFilingNumber))}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // Second, independent re-check against the legacy seed dataset directly
  // (see module comment) -- catches the case a DB-only check would miss.
  const legacySeedOverlap = selected.filter((fn) => legacySeedFilingNumbers.has(fn));
  console.log(`Selected filing numbers re-checked against hidalgo-real-cases.ts (legacy seed, bypasses the DB column): ${selected.length}`);
  console.log(`Matches found (must be 0): ${legacySeedOverlap.length}`);
  if (legacySeedOverlap.length > 0) {
    console.error(`FATAL: legacy-seed non-overlap proof FAILED -- ${legacySeedOverlap.length} of the selected filing numbers match a legacy seeded case: ${JSON.stringify(legacySeedOverlap)}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  console.log(`PASSED: zero overlap confirmed against both the database and the legacy seed dataset. Selection is safe to use for the bounded production run.`);

  console.log(`\n=== Coverage context ===`);
  console.log(`Total bundle notices (this scan): ${bundleNoticeCountForCoverage ?? "unknown"}`);
  console.log(`Currently ingested: ${existingFilingNumbers.size}`);
  console.log(`This batch would bring ingested count to: ${existingFilingNumbers.size + selected.length}`);
  if (bundleNoticeCountForCoverage) {
    console.log(`Projected coverage after this batch: ${existingFilingNumbers.size + selected.length} / ${bundleNoticeCountForCoverage} = ${(((existingFilingNumbers.size + selected.length) / bundleNoticeCountForCoverage) * 100).toFixed(1)}%`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    targetCount: TARGET_COUNT,
    selectedCount: selected.length,
    selectedFilingNumbers: selected,
    recommendedMaxNoticesPerBundle: windowSizeInLatestBundle,
    currentForeclosureCaseCount: totalCaseCount,
    currentDistinctFilingNumberCount: existingFilingNumbers.size,
    bundleNoticeCount: bundleNoticeCountForCoverage,
  };
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nSelection written to ${OUTPUT_PATH.pathname}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
