/**
 * Bulk derived-data regeneration for the remaining 72 baseline cases
 * (the 82-case accepted production baseline minus the 10 already
 * processed by the pilot -- see docs/DEPLOYMENT.md's pilot report and
 * the "10-case regeneration pilot" section). Thin wrapper around the
 * same shared, already-verified per-case logic used by the pilot (see
 * apps/web/lib/regeneration/regenerateCase.ts for the full safety
 * contract -- unchanged here).
 *
 * This is derived-data regeneration ONLY:
 *  - Zero ForeclosureCase or SourceDocument writes (the case set is
 *    queried, never created).
 *  - Zero ingestion, zero discovery, zero new-county work.
 *  - Zero AI calls (resolvePropertyAddress is CAD-only).
 *  - Notice-transcribed Property fields (address/subdivision/lot/block)
 *    are never overwritten -- CAD only attaches propertyIdNumber/
 *    geographicId/lat-long/valuation on top of them.
 *  - NO_ADDRESS_RESOLVED cases never get an automatic Property
 *    assignment regardless of confidence -- human Approve still required.
 *
 * Runs via GitHub Actions, not a Netlify Function, for the same reason
 * as the pilot: CAD requests are rate-limited (~2s/request) and 72 cases
 * can take several minutes to tens of minutes end to end.
 */
import { prisma } from "@foreclosuredata/database";
import { regenerateCase, blankErrorReport, type CaseReport } from "../lib/regeneration/regenerateCase";

const PILOT_CASE_IDS = new Set([
  "28284986-a090-4414-abb3-d990a23fda08", // HID-117911
  "d8f8c8da-c2cd-447f-bb04-4d91b8ffabc0", // HID-117957
  "bd2083f9-eeb7-4b3c-86d5-258471c16459", // HID-118234
  "21397060-b5d3-42e7-88b8-8e1cd96eb22d", // HID-118198
  "1d5254cc-e6be-4760-8a7b-2ade341df3c3", // HID-117925
  "9d251e2f-dc28-4095-a3e5-eb352aec144b", // HID-118210
  "bd14d37d-b457-423b-95ec-d66c118db475", // HID-117931
  "58614cf8-888a-428f-842a-4d650a1bfb2a", // HID-118201
  "ca0e4aaf-7a4a-4917-8852-4e813b9535c9", // HID-118228
  "7cf34318-5849-43cf-ab64-3cd7bf10d089", // HID-118156
]);

const EXPECTED_REMAINING_COUNT = 72;

const MAX_REQUESTS_PER_CASE = intEnv("BULK_MAX_REQUESTS_PER_CASE", 10);
const MAX_GLOBAL_REQUESTS = intEnv("BULK_MAX_GLOBAL_REQUESTS", 500);
const VALUATION_MAX_YEARS_BACK = intEnv("BULK_VALUATION_MAX_YEARS_BACK", 2);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"')]+/gi, "[REDACTED_DB_URL]").replace(/sk-ant-[A-Za-z0-9_\-]+/gi, "[REDACTED_API_KEY]");
}

async function main() {
  const startedAt = Date.now();
  console.log(`=== 72-case bulk CAD regeneration (${new Date().toISOString()}) ===`);

  const allCases = await prisma.foreclosureCase.findMany({ select: { id: true, caseNumber: true }, orderBy: { caseNumber: "asc" } });
  const remaining = allCases.filter((c) => !PILOT_CASE_IDS.has(c.id));

  console.log(`Total baseline cases found: ${allCases.length}`);
  console.log(`Already processed by the 10-case pilot: ${PILOT_CASE_IDS.size}`);
  console.log(`Remaining to process this run: ${remaining.length}`);

  if (allCases.length !== 82 || remaining.length !== EXPECTED_REMAINING_COUNT) {
    // Loud, not fatal -- the baseline may have legitimately been touched
    // by the pilot's own writes (candidates/audit rows, never case
    // counts), but a case-COUNT drift from 82/72 is exactly the kind of
    // scope surprise this run must never process silently.
    console.warn(
      `WARNING: expected 82 total baseline cases and ${EXPECTED_REMAINING_COUNT} remaining after excluding the pilot's 10, ` +
        `but found ${allCases.length} total / ${remaining.length} remaining. Proceeding with exactly what was found, but this ` +
        `is worth investigating before trusting this run's aggregates as "the full 82-case baseline."`,
    );
  }

  console.log(`Per-case CAD request cap: ${MAX_REQUESTS_PER_CASE}`);
  console.log(`Global CAD request cap: ${MAX_GLOBAL_REQUESTS}`);
  console.log(`Valuation year lookback: ${VALUATION_MAX_YEARS_BACK}`);
  console.log(`Rate limiting: inherited from hidalgoCadClient (single in-flight request, HIDALGO_CAD_REQUEST_DELAY_MS between requests)`);

  const globalBudget = { remaining: MAX_GLOBAL_REQUESTS };
  const reports: CaseReport[] = [];
  const options = { maxRequestsPerCase: MAX_REQUESTS_PER_CASE, valuationMaxYearsBack: VALUATION_MAX_YEARS_BACK, runLabel: "BULK-72" };

  for (const c of remaining) {
    try {
      const report = await regenerateCase(c.id, globalBudget, options);
      reports.push(report);
      console.log(`[${report.caseNumber}] ${report.cadStatus} -- requests=${report.cadRequestsUsed}, candidates=${report.candidatesReturned}, propertyChanged=${report.existingProductionFieldChanged}`);
    } catch (err) {
      const message = err instanceof Error ? redact(err.message) : redact(String(err));
      console.error(`[${c.caseNumber ?? c.id}] ERROR: ${message}`);
      reports.push(blankErrorReport(c.id, message));
      try {
        await prisma.auditLog.create({ data: { action: "CASE_FAILED", entityType: "ForeclosureCase", entityId: c.id, afterJson: { runLabel: options.runLabel, error: message } } });
      } catch {
        // Isolation: even a failure to write the failure audit log must not abort the loop.
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const aggregates = {
    casesProcessed: reports.length,
    existingAddressCadConfirmed: reports.filter((r) => r.addressResolvedFromNotice && r.cadStatus === "CAD_PARCEL_CONFIRMED").length,
    unresolvedWithViableCandidate: reports.filter((r) => !r.addressResolvedFromNotice && r.cadStatus === "REQUIRES_HUMAN_APPROVAL").length,
    unresolvedStillUnresolved: reports.filter((r) => !r.addressResolvedFromNotice && r.cadStatus === "NO_CAD_MATCH").length,
    ownerConflicts: reports.filter((r) => r.conflictingFields.includes("ownerName")).length,
    subdivisionOrFieldConflicts: reports.filter((r) => r.conflictingFields.some((f) => f !== "ownerName")).length,
    ambiguousMatches: reports.filter((r) => r.cadStatus === "REQUIRES_HUMAN_APPROVAL" && !r.selectedOrProposedCandidate).length,
    valuationEnrichmentRate: reports.filter((r) => r.valuationYear !== null).length,
    totalCadRequests: reports.reduce((s, r) => s + r.cadRequestsUsed, 0),
    averageCadRequestsPerCase: reports.length ? reports.reduce((s, r) => s + r.cadRequestsUsed, 0) / reports.length : 0,
    maxCadRequestsSingleCase: reports.length ? Math.max(...reports.map((r) => r.cadRequestsUsed)) : 0,
    errors: reports.filter((r) => r.cadStatus === "ERROR").length,
    skippedGlobalBudget: reports.filter((r) => r.cadStatus === "SKIPPED_GLOBAL_BUDGET_EXHAUSTED").length,
    runtimeSeconds: elapsedMs / 1000,
  };

  console.log(`\n=== Bulk-72 summary ===`);
  console.log(JSON.stringify({ reports, aggregates }, null, 2));

  await prisma.auditLog.create({
    data: {
      action: "REGENERATION_RUN_SUMMARY",
      entityType: "PilotRun",
      entityId: `${options.runLabel}-${new Date().toISOString().slice(0, 10)}`,
      afterJson: { runLabel: options.runLabel, aggregates, caseCount: remaining.length },
    },
  });

  console.log(`\nTotal runtime: ${aggregates.runtimeSeconds.toFixed(1)}s`);
  console.log(`Anthropic cost: $0.00 (no AI calls in this pipeline stage)`);
}

main()
  .catch((err) => {
    console.error("FATAL:", err instanceof Error ? redact(err.message) : redact(String(err)));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
