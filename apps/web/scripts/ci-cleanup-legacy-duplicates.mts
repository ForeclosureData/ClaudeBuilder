/**
 * Safe legacy-duplicate cleanup for the two confirmed same-event pairs
 * found by ci-reconcile-legacy.mts (Phase 1 of the productization pass):
 *
 *   legacy HID-118231 (instrument 3213841) == ingested HID-117997
 *   legacy HID-118219 (instrument 2506256) == ingested HID-117961
 *
 * Archives the LEGACY row in each pair (never the automated-ingestion row,
 * which carries the richer downstream property-resolution/CAD/valuation
 * data) via the existing archivedAt/archivedReason/mergedIntoCaseId fields
 * -- never a hard delete, so SourceDocument/ForeclosureSale/Loan/
 * LegalDescription child rows and the full audit trail stay intact and
 * queryable on the archived case.
 *
 * Before archiving, backfills any field on the SURVIVING (ingested) case
 * where the legacy row's manually-transcribed value is clearly more
 * complete/accurate than the automated extraction -- specifically, a real
 * borrower name superseding the "Unknown owner" placeholder. This is the
 * same per-field-supersession principle used by the project's earlier
 * backfill script (never overwrites a real value with a worse one, only
 * fills a gap or replaces a known placeholder).
 *
 * DRY_RUN=true (default): zero writes, prints every planned mutation.
 * DRY_RUN=false: executes the writes inside a single transaction per pair.
 */
import { prisma } from "@foreclosuredata/database";

const DRY_RUN = process.env.DRY_RUN !== "false";

const PAIRS: Array<{ legacyCaseNumber: string; survivingCaseNumber: string; instrumentNumber: string }> = [
  { legacyCaseNumber: "HID-118231", survivingCaseNumber: "HID-117997", instrumentNumber: "3213841" },
  { legacyCaseNumber: "HID-118219", survivingCaseNumber: "HID-117961", instrumentNumber: "2506256" },
];

const PLACEHOLDER_NAMES = new Set(["unknown owner"]);

async function main() {
  console.log(`=== Legacy-duplicate cleanup (${new Date().toISOString()}) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (zero writes)" : "LIVE (will mutate production)"}\n`);

  for (const pair of PAIRS) {
    const legacy = await prisma.foreclosureCase.findFirst({
      where: { caseNumber: pair.legacyCaseNumber, archivedAt: null },
      include: { borrower: true, grantor: true },
    });
    const surviving = await prisma.foreclosureCase.findFirst({
      where: { caseNumber: pair.survivingCaseNumber, archivedAt: null },
      include: { borrower: true, grantor: true },
    });

    console.log(`--- Pair: ${pair.legacyCaseNumber} (legacy) -> ${pair.survivingCaseNumber} (surviving) ---`);

    if (!legacy) {
      console.log(`SKIP: legacy case ${pair.legacyCaseNumber} not found or already archived.\n`);
      continue;
    }
    if (!surviving) {
      console.log(`SKIP: surviving case ${pair.survivingCaseNumber} not found or already archived.\n`);
      continue;
    }

    console.log(`Legacy borrower: "${legacy.borrower?.fullName ?? "(none)"}" | Surviving borrower: "${surviving.borrower?.fullName ?? "(none)"}"`);

    const survivingBorrowerIsPlaceholder = surviving.borrower?.fullName ? PLACEHOLDER_NAMES.has(surviving.borrower.fullName.trim().toLowerCase()) : true;
    const legacyBorrowerIsReal = legacy.borrower?.fullName && !PLACEHOLDER_NAMES.has(legacy.borrower.fullName.trim().toLowerCase());

    const plannedActions: string[] = [];
    if (survivingBorrowerIsPlaceholder && legacyBorrowerIsReal && surviving.borrowerPersonId) {
      plannedActions.push(`Update surviving case's borrower Person(${surviving.borrowerPersonId}).fullName from "${surviving.borrower?.fullName}" to "${legacy.borrower!.fullName}"`);
    }
    if (survivingBorrowerIsPlaceholder && legacyBorrowerIsReal && surviving.grantorPersonId && surviving.grantorPersonId !== surviving.borrowerPersonId) {
      plannedActions.push(`Update surviving case's grantor Person(${surviving.grantorPersonId}).fullName from "${surviving.grantor?.fullName}" to "${legacy.grantor!.fullName}"`);
    }
    plannedActions.push(`Archive legacy case ${legacy.caseNumber} (id ${legacy.id}): set archivedAt=now(), archivedReason="Superseded by ${surviving.caseNumber} -- same Deed of Trust instrument #${pair.instrumentNumber}, confirmed via legacy-vs-ingested reconciliation", mergedIntoCaseId=${surviving.id}`);

    console.log(`Planned actions:`);
    for (const a of plannedActions) console.log(`  - ${a}`);

    if (DRY_RUN) {
      console.log(`DRY RUN: no writes performed.\n`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      if (survivingBorrowerIsPlaceholder && legacyBorrowerIsReal && surviving.borrowerPersonId) {
        await tx.person.update({ where: { id: surviving.borrowerPersonId }, data: { fullName: legacy.borrower!.fullName } });
      }
      if (survivingBorrowerIsPlaceholder && legacyBorrowerIsReal && surviving.grantorPersonId && surviving.grantorPersonId !== surviving.borrowerPersonId) {
        await tx.person.update({ where: { id: surviving.grantorPersonId }, data: { fullName: legacy.grantor!.fullName } });
      }
      await tx.foreclosureCase.update({
        where: { id: legacy.id },
        data: {
          archivedAt: new Date(),
          archivedReason: `Superseded by ${surviving.caseNumber} -- same Deed of Trust instrument #${pair.instrumentNumber}, confirmed via legacy-vs-ingested reconciliation`,
          mergedIntoCaseId: surviving.id,
        },
      });
    });
    console.log(`LIVE: mutations applied.\n`);
  }

  console.log(`Done.`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
