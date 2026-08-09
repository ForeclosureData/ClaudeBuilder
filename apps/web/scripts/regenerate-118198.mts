/**
 * Closes a gap left by the pilot: HID-118198 errored during the original
 * 10-case pilot run (pre-fix sanitizer), and the two subsequent
 * verification passes (apps/web/scripts/verify-118198.mts) were
 * deliberately read-only. This is the one real, write-enabled pass for
 * that single case, using the exact same shared, already-verified logic
 * as the pilot and the 72-case bulk run (apps/web/lib/regeneration/
 * regenerateCase.ts) -- run only after two read-only dry-runs confirmed
 * it's safe (the found candidate correctly stays unselected due to a
 * genuine lot-field mismatch, not a bug -- see docs/DEPLOYMENT.md).
 */
import { prisma } from "@foreclosuredata/database";
import { regenerateCase } from "../lib/regeneration/regenerateCase";

const CASE_ID = "21397060-b5d3-42e7-88b8-8e1cd96eb22d"; // HID-118198

async function main() {
  const globalBudget = { remaining: 10 };
  const report = await regenerateCase(CASE_ID, globalBudget, { maxRequestsPerCase: 10, valuationMaxYearsBack: 2, runLabel: "HID-118198-CLOSEOUT" });
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
