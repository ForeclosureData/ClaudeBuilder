/**
 * 10-case bounded derived-data regeneration pilot (2026-08-08). Already
 * run once -- see docs/DEPLOYMENT.md's "10-case regeneration pilot --
 * results" section for the full report. Kept for the record / rerunning
 * if ever needed; now a thin wrapper around the shared per-case logic in
 * apps/web/lib/regeneration/regenerateCase.ts (see that file's header
 * comment for the full safety contract, shared with
 * regenerate-remaining-72.mts).
 *
 * Runs via GitHub Actions rather than a Netlify Function because CAD
 * requests are deliberately rate-limited (~2s/request) and a 10-case run
 * can take several minutes end to end -- too long for a serverless
 * function, same reasoning as ci-ingest-hidalgo.mts.
 */
import { prisma } from "@foreclosuredata/database";
import { regenerateCase, blankErrorReport, type CaseReport } from "../lib/regeneration/regenerateCase";

const PILOT_CASE_IDS = [
  "28284986-a090-4414-abb3-d990a23fda08", // HID-117911 -- existing address
  "d8f8c8da-c2cd-447f-bb04-4d91b8ffabc0", // HID-117957 -- existing address
  "bd2083f9-eeb7-4b3c-86d5-258471c16459", // HID-118234 -- existing address (Buchanan Estates -- historically relevant)
  "21397060-b5d3-42e7-88b8-8e1cd96eb22d", // HID-118198 -- existing address (messy legal description, owner unrecoverable)
  "1d5254cc-e6be-4760-8a7b-2ade341df3c3", // HID-117925 -- NO_ADDRESS_RESOLVED
  "9d251e2f-dc28-4095-a3e5-eb352aec144b", // HID-118210 -- NO_ADDRESS_RESOLVED
  "bd14d37d-b457-423b-95ec-d66c118db475", // HID-117931 -- NO_ADDRESS_RESOLVED (messy legal description)
  "58614cf8-888a-428f-842a-4d650a1bfb2a", // HID-118201 -- NO_ADDRESS_RESOLVED (messy legal description)
  "ca0e4aaf-7a4a-4917-8852-4e813b9535c9", // HID-118228 -- NO_ADDRESS_RESOLVED (recurring subdivision name, POOR_TEXT_QUALITY)
  "7cf34318-5849-43cf-ab64-3cd7bf10d089", // HID-118156 -- NO_ADDRESS_RESOLVED
] as const;

const MAX_REQUESTS_PER_CASE = intEnv("PILOT_MAX_REQUESTS_PER_CASE", 10);
const MAX_GLOBAL_REQUESTS = intEnv("PILOT_MAX_GLOBAL_REQUESTS", 60);
const VALUATION_MAX_YEARS_BACK = intEnv("PILOT_VALUATION_MAX_YEARS_BACK", 2);

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
  console.log(`=== 10-case CAD regeneration pilot (${new Date().toISOString()}) ===`);
  console.log(`Case count: ${PILOT_CASE_IDS.length} (hard-coded, no discovery)`);
  console.log(`Per-case CAD request cap: ${MAX_REQUESTS_PER_CASE}`);
  console.log(`Global CAD request cap: ${MAX_GLOBAL_REQUESTS}`);
  console.log(`Valuation year lookback: ${VALUATION_MAX_YEARS_BACK}`);
  console.log(`Rate limiting: inherited from hidalgoCadClient (single in-flight request, HIDALGO_CAD_REQUEST_DELAY_MS between requests)`);

  const globalBudget = { remaining: MAX_GLOBAL_REQUESTS };
  const reports: CaseReport[] = [];
  const options = { maxRequestsPerCase: MAX_REQUESTS_PER_CASE, valuationMaxYearsBack: VALUATION_MAX_YEARS_BACK, runLabel: "PILOT-10" };

  for (const caseId of PILOT_CASE_IDS) {
    try {
      const report = await regenerateCase(caseId, globalBudget, options);
      reports.push(report);
      console.log(`\n[${report.caseNumber}] ${report.cadStatus} -- requests=${report.cadRequestsUsed}, candidates=${report.candidatesReturned}, propertyChanged=${report.existingProductionFieldChanged}`);
    } catch (err) {
      const message = err instanceof Error ? redact(err.message) : redact(String(err));
      console.error(`\n[${caseId}] ERROR: ${message}`);
      reports.push(blankErrorReport(caseId, message));
      try {
        await prisma.auditLog.create({ data: { action: "CASE_FAILED", entityType: "ForeclosureCase", entityId: caseId, afterJson: { runLabel: options.runLabel, error: message } } });
      } catch {
        // Isolation: even a failure to write the failure audit log must not abort the loop.
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const aggregates = {
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

  console.log(`\n=== Pilot summary ===`);
  console.log(JSON.stringify({ reports, aggregates }, null, 2));

  await prisma.auditLog.create({
    data: {
      action: "REGENERATION_RUN_SUMMARY",
      entityType: "PilotRun",
      entityId: `${options.runLabel}-${new Date().toISOString().slice(0, 10)}`,
      afterJson: { runLabel: options.runLabel, aggregates, caseIds: PILOT_CASE_IDS },
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
