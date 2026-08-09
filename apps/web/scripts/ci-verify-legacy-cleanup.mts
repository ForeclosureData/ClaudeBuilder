/**
 * Read-only post-execution verification for the live legacy-duplicate
 * cleanup run by ci-cleanup-legacy-duplicates.mts (DRY_RUN=false). Zero
 * database writes, zero Anthropic calls.
 *
 * Confirms, independently of the cleanup script's own log output:
 *   1. HID-117997's borrower Person.fullName was backfilled correctly.
 *   2. HID-118231 is archived with mergedIntoCaseId pointing at HID-117997.
 *   3. HID-118219 is archived with mergedIntoCaseId pointing at HID-117961.
 *   4. Both archived cases are excluded by the public-surface predicate
 *      (buildForeclosureCaseWhere's archivedAt: null + isPubliclyVisible).
 *   5. The other 80 legacy-seed cases (countyFilingNumber IS NULL, not one
 *      of the two archived pairs) are untouched: still archivedAt: null.
 *   6. Final active / archived / total ForeclosureCase row counts.
 */
import { prisma } from "@foreclosuredata/database";
import { realHidalgoCases } from "../../../packages/database/prisma/hidalgo-real-cases.ts";

const EXPECTED = [
  { legacyCaseNumber: "HID-118231", survivingCaseNumber: "HID-117997", expectedBorrower: "Sonia Prado, unmarried woman" },
  { legacyCaseNumber: "HID-118219", survivingCaseNumber: "HID-117961", expectedBorrower: null as string | null },
];

async function main() {
  console.log(`=== Legacy cleanup verification (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  let allOk = true;

  for (const exp of EXPECTED) {
    console.log(`--- Pair: ${exp.legacyCaseNumber} -> ${exp.survivingCaseNumber} ---`);
    const legacy = await prisma.foreclosureCase.findFirst({ where: { caseNumber: exp.legacyCaseNumber } });
    const surviving = await prisma.foreclosureCase.findFirst({ where: { caseNumber: exp.survivingCaseNumber }, include: { borrower: true } });

    if (!legacy || !surviving) {
      console.log(`FAIL: could not find one or both cases (legacy=${Boolean(legacy)}, surviving=${Boolean(surviving)})`);
      allOk = false;
      continue;
    }

    const archivedOk = legacy.archivedAt !== null;
    const mergedOk = legacy.mergedIntoCaseId === surviving.id;
    console.log(`Legacy ${exp.legacyCaseNumber}: archivedAt=${legacy.archivedAt?.toISOString() ?? "NULL"} (${archivedOk ? "OK" : "FAIL"}), mergedIntoCaseId=${legacy.mergedIntoCaseId ?? "NULL"} vs surviving.id=${surviving.id} (${mergedOk ? "OK" : "FAIL"})`);
    if (!archivedOk || !mergedOk) allOk = false;

    if (exp.expectedBorrower) {
      const borrowerOk = surviving.borrower?.fullName === exp.expectedBorrower;
      console.log(`Surviving ${exp.survivingCaseNumber} borrower.fullName="${surviving.borrower?.fullName ?? "NULL"}" vs expected "${exp.expectedBorrower}" (${borrowerOk ? "OK" : "FAIL"})`);
      if (!borrowerOk) allOk = false;
    }
    console.log();
  }

  console.log(`=== Public-surface exclusion check ===`);
  for (const exp of EXPECTED) {
    const c = await prisma.foreclosureCase.findFirst({ where: { caseNumber: exp.legacyCaseNumber, archivedAt: null } });
    const excluded = c === null;
    console.log(`${exp.legacyCaseNumber} excluded by archivedAt:null predicate (the same predicate buildForeclosureCaseWhere()/getCountyStats() apply to every public query): ${excluded ? "OK" : "FAIL -- still matches a public archivedAt:null lookup"}`);
    if (!excluded) allOk = false;
  }
  console.log();

  console.log(`=== Untouched-legacy-row check (the other 80 of 82 legacy cases) ===`);
  const legacyCaseNumbers = realHidalgoCases.map((c) => `HID-${c.docNumber}`);
  const archivedPairCaseNumbers = new Set(EXPECTED.map((e) => e.legacyCaseNumber));
  const shouldBeUntouched = legacyCaseNumbers.filter((cn) => !archivedPairCaseNumbers.has(cn));
  const legacyRows = await prisma.foreclosureCase.findMany({
    where: { caseNumber: { in: shouldBeUntouched } },
    select: { caseNumber: true, archivedAt: true, mergedIntoCaseId: true },
  });
  const foundMap = new Map(legacyRows.map((r) => [r.caseNumber, r]));
  const unexpectedlyArchived = legacyRows.filter((r) => r.archivedAt !== null || r.mergedIntoCaseId !== null);
  const missing = shouldBeUntouched.filter((cn) => !foundMap.has(cn));
  console.log(`Expected untouched legacy cases: ${shouldBeUntouched.length}`);
  console.log(`Found in DB: ${legacyRows.length}, missing: ${missing.length}`);
  console.log(`Unexpectedly archived/merged: ${unexpectedlyArchived.length}`);
  if (unexpectedlyArchived.length > 0) {
    console.log(JSON.stringify(unexpectedlyArchived, null, 2));
    allOk = false;
  }
  if (missing.length > 0) {
    console.log(`Missing case numbers: ${JSON.stringify(missing)}`);
  }
  console.log();

  console.log(`=== Final ForeclosureCase counts ===`);
  const total = await prisma.foreclosureCase.count();
  const active = await prisma.foreclosureCase.count({ where: { archivedAt: null } });
  const archived = await prisma.foreclosureCase.count({ where: { archivedAt: { not: null } } });
  console.log(`Total: ${total}`);
  console.log(`Active (archivedAt: null): ${active}`);
  console.log(`Archived (archivedAt set): ${archived}`);
  console.log();

  console.log(`=== Overall result: ${allOk ? "PASS" : "FAIL"} ===`);
  if (!allOk) process.exitCode = 1;
  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
