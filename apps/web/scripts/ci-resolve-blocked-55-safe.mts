/**
 * Phase 5 + Phase 6 of the 55-case publication-blocker triage: executes
 * ONLY the mutations that meet every low-risk criterion from the user's
 * spec -- existing stored evidence is sufficient, no unresolved
 * property-identity conflict is introduced, no confidence threshold is
 * lowered, no new fuzzy matching, fully reversible/audited (AuditLog with
 * before/after on every write), never deletes a source record.
 *
 * Three action groups, all derived from ci-freeze-blocked-55.mts output
 * (see the accompanying triage report for the full case-by-case evidence):
 *
 * 1. ADDRESS_CORRECTIONS (13 cases) -- "Bucket A: resolvable from existing
 *    evidence". Each of these cases' extracted propertyStreetAddress is
 *    verified, byte-for-byte, to be a Substitute Trustee's / Trustee's /
 *    Lender's office address (or the Hidalgo County Courthouse address,
 *    317 N Closner Blvd) lifted from the notice's boilerplate, not the
 *    foreclosed property -- proven by exact reuse across multiple
 *    unrelated cases (the same structural signal isRepeatedAcrossCases()
 *    already guards against on new ingestion, applied here retroactively
 *    to this specific evidenced cluster only, not the full 282/364 set).
 *    Corrects the field to UNRESOLVED rather than guessing a real address.
 *
 * 2. FALSE_POSITIVE_TASK_CLOSURES (3 tasks) -- "Bucket E". HID-117997's
 *    BORROWER_NAME_CONFLICT predates the already-approved legacy-duplicate
 *    borrower backfill (Sonia Prado, cross-corroborated by two independent
 *    source notices and CAD-confirmed) -- the flag is stale, not wrong.
 *    HID-117675/HID-117908's CAD_OWNER_CONFLICT tasks are closed as a
 *    direct, evidenced consequence of action 1: the "conflict" was the CAD
 *    system correctly reporting that the courthouse address belongs to
 *    Hidalgo County -- once the bogus address is removed, there is no
 *    conflict left to review, only an honest missing-property-identifier
 *    gap (which stays open/blocked, not fabricated).
 *
 * 3. DUPLICATE_CANONICALIZATION (1 pair) -- Phase 6. HID-117731 and
 *    HID-117729 carry a CONFIRMED_SAME_EVENT PossibleDuplicateNoticeLink
 *    (score 1.0, zero conflicting fields, 9 matched fields including a
 *    shared trustee/servicer tracking number and 98% near-identical raw
 *    text). HID-117729 is selected as canonical -- it is the case the
 *    duplicate-detection engine found already on file when HID-117731 was
 *    ingested (per HID-117731's own POSSIBLE_CONTENT_DUPLICATE task note),
 *    i.e. the earlier-filed, non-duplicate-flagging side. Uses the exact
 *    archivedAt/archivedReason/mergedIntoCaseId mechanism already reviewed
 *    and approved by the user for the HID-118231/HID-117997 and
 *    HID-118219/HID-117961 legacy pairs -- never a new schema/workflow.
 *    Both filing numbers are preserved (117731's in archivedReason text,
 *    matching that same precedent); no row is deleted.
 *
 * DRY_RUN=true (default): zero writes, prints every planned mutation and
 * the evidence backing it. DRY_RUN=false: executes, with an AuditLog
 * before/after entry for every row touched.
 */
import { prisma } from "@foreclosuredata/database";

const DRY_RUN = process.env.DRY_RUN !== "false";

interface AddressCorrection {
  caseNumber: string;
  expectedBogusAddress: string;
  evidence: string;
}

const ADDRESS_CORRECTIONS: AddressCorrection[] = [
  { caseNumber: "HID-118147", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Trustee's Address\" / \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118149", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118150", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118151", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118152", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118153", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Substitute Trustee's Address\"." },
  { caseNumber: "HID-118154", expectedBogusAddress: "3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539", evidence: "Exact match to 6 other unrelated cases' extracted address; raw notice text labels it \"Trustee's Address\"." },
  { caseNumber: "HID-117675", expectedBogusAddress: "317 N Closner, Edinburg TX 78539", evidence: "317 N. Closner Blvd is the Hidalgo County Courthouse -- CAD's own top candidate for this address is owned by \"COUNTY OF HIDALGO\", confirming this is the sale-location/courthouse address, not the foreclosed property. Exact match to 3 other unrelated cases." },
  { caseNumber: "HID-117908", expectedBogusAddress: "317 N Closner, Edinburg TX 78539", evidence: "317 N. Closner Blvd is the Hidalgo County Courthouse -- CAD's own top candidate for this address is owned by \"COUNTY OF HIDALGO\". Exact match to 3 other unrelated cases." },
  { caseNumber: "HID-118163", expectedBogusAddress: "902 Bighorn Drive, Edinburg, Texas 78542", evidence: "Raw notice text explicitly labels this \"Trustee's Address\" and \"Lender's Address\". Exact match to HID-118176. This case has its own distinct, valid legal description (San Martin Subdivision Lot 14) proving it is a genuinely different property from the address text." },
  { caseNumber: "HID-118176", expectedBogusAddress: "902 Bighorn Drive, Edinburg, Texas 78542", evidence: "Raw notice text explicitly labels this \"Trustee's Address\" and \"Lender's Address\". Exact match to HID-118163. This case has its own distinct, valid legal description (San Patricio Subdivision Lot 42)." },
  { caseNumber: "HID-117731", expectedBogusAddress: "317 N Closner, Edinburg TX 78539", evidence: "317 N. Closner Blvd is the Hidalgo County Courthouse. Exact match to 3 other unrelated cases. Also part of the HID-117731/HID-117729 confirmed-duplicate pair (see DUPLICATE_CANONICALIZATION below)." },
  { caseNumber: "HID-117729", expectedBogusAddress: "317 N Closner, Edinburg TX 78539", evidence: "317 N. Closner Blvd is the Hidalgo County Courthouse. Exact match to 3 other unrelated cases. Selected as the canonical case in DUPLICATE_CANONICALIZATION below -- must be corrected before its duplicate-link block is cleared, so it is never publicly shown with the courthouse address." },
];

interface FalsePositiveClosure {
  caseNumber: string;
  reason: string;
  resolutionNote: string;
}

const FALSE_POSITIVE_TASK_CLOSURES: FalsePositiveClosure[] = [
  {
    caseNumber: "HID-117997",
    reason: "BORROWER_NAME_CONFLICT",
    resolutionNote:
      "Resolved: stale flag predating the approved legacy-duplicate cleanup (see HID-118231 archival). Borrower name \"Sonia Prado, unmarried woman\" is now cross-corroborated by two independently-sourced notices (this case and the archived HID-118231) and matches the CAD-confirmed parcel owner (\"PRADO SONIA\", 112 Wisteria Ave, McAllen). No remaining conflict.",
  },
  {
    caseNumber: "HID-117675",
    reason: "CAD_OWNER_CONFLICT",
    resolutionNote:
      "Resolved: the flagged \"conflict\" was CAD correctly reporting that 317 N Closner Blvd (the Hidalgo County Courthouse) is owned by \"COUNTY OF HIDALGO\" -- that address has now been removed from this case as a boilerplate courthouse-address extraction error (see ADDRESS_CORRECTIONS). No real owner conflict exists; case remains blocked on missing property identifier, not on this now-moot signal.",
  },
  {
    caseNumber: "HID-117908",
    reason: "CAD_OWNER_CONFLICT",
    resolutionNote:
      "Resolved: same root cause as HID-117675 -- the flagged conflict was CAD correctly reporting the Hidalgo County Courthouse's true owner for the erroneously-extracted 317 N Closner Blvd address, now corrected. No real owner conflict exists; case remains blocked on missing property identifier, not on this now-moot signal.",
  },
];

const DUPLICATE_CANONICALIZATION = {
  canonicalCaseNumber: "HID-117729",
  duplicateCaseNumber: "HID-117731",
  rationale:
    "CONFIRMED_SAME_EVENT (score 1.0, zero conflicting fields). Matched: trusteeSaleTrackingNumber, rawTextFingerprint (98% near-identical), propertyAddress, legalDescription, borrowerNames, originalPrincipalAmount, deedOfTrustDate, saleDate, lenderName. HID-117729 selected canonical: it is the case HID-117731's own POSSIBLE_CONTENT_DUPLICATE task recorded as already on file at ingestion time (earlier-filed, non-duplicate-flagging side); the two are otherwise informationally identical (same CAD candidate pool, same unresolved status) so no other differentiator applies.",
};

async function main() {
  console.log(`=== Blocked-55 safe resolution pass (${new Date().toISOString()}) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (zero writes)" : "LIVE (will mutate production)"}\n`);

  console.log(`=== 1. ADDRESS_CORRECTIONS (${ADDRESS_CORRECTIONS.length} cases) ===`);
  for (const ac of ADDRESS_CORRECTIONS) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: ac.caseNumber, archivedAt: null }, include: { property: true } });
    if (!fc) {
      console.log(`SKIP ${ac.caseNumber}: case not found or already archived.\n`);
      continue;
    }
    if (!fc.property) {
      console.log(`SKIP ${ac.caseNumber}: no Property row.\n`);
      continue;
    }
    const currentAddr = (fc.property.propertyStreetAddress ?? "").trim().toUpperCase();
    if (currentAddr !== ac.expectedBogusAddress.trim().toUpperCase()) {
      console.log(`SKIP ${ac.caseNumber}: current address "${fc.property.propertyStreetAddress}" no longer matches expected bogus value "${ac.expectedBogusAddress}" -- state changed since triage, needs re-review, not touching.\n`);
      continue;
    }
    const before = { propertyStreetAddress: fc.property.propertyStreetAddress, addressResolutionMethod: fc.property.addressResolutionMethod, addressResolutionConfidence: fc.property.addressResolutionConfidence, addressResolutionExplanation: fc.property.addressResolutionExplanation };
    const after = { propertyStreetAddress: null, addressResolutionMethod: "UNRESOLVED" as const, addressResolutionConfidence: null, addressResolutionExplanation: `Corrected via blocked-55 triage: extracted address was a trustee/lender/courthouse boilerplate address, not the foreclosed property. ${ac.evidence} Original value: "${before.propertyStreetAddress}".` };
    console.log(`${ac.caseNumber}: property ${fc.property.id} -- clearing bogus address "${before.propertyStreetAddress}". Evidence: ${ac.evidence}`);
    if (DRY_RUN) {
      console.log(`  DRY RUN: no writes performed.\n`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.property.update({ where: { id: fc.property!.id }, data: after });
      await tx.auditLog.create({ data: { actorId: null, action: "CORRECT_TRUSTEE_ADDRESS_MISATTRIBUTION", entityType: "Property", entityId: fc.property!.id, beforeJson: before, afterJson: after } });
    });
    console.log(`  LIVE: corrected.\n`);
  }

  console.log(`=== 2. FALSE_POSITIVE_TASK_CLOSURES (${FALSE_POSITIVE_TASK_CLOSURES.length} tasks) ===`);
  for (const fp of FALSE_POSITIVE_TASK_CLOSURES) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: fp.caseNumber, archivedAt: null } });
    if (!fc) {
      console.log(`SKIP ${fp.caseNumber}: case not found or already archived.\n`);
      continue;
    }
    const task = await prisma.manualReviewTask.findFirst({ where: { foreclosureCaseId: fc.id, reason: fp.reason as never, status: "OPEN" } });
    if (!task) {
      console.log(`SKIP ${fp.caseNumber}/${fp.reason}: no matching OPEN task found -- state changed since triage, not touching.\n`);
      continue;
    }
    const before = { status: task.status, notes: task.notes, resolvedAt: task.resolvedAt };
    const after = { status: "RESOLVED" as const, notes: `${task.notes ?? ""}\n\n${fp.resolutionNote}`.trim(), resolvedAt: new Date() };
    console.log(`${fp.caseNumber}/${fp.reason}: closing task ${task.id}. ${fp.resolutionNote}`);
    if (DRY_RUN) {
      console.log(`  DRY RUN: no writes performed.\n`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.manualReviewTask.update({ where: { id: task.id }, data: after });
      await tx.auditLog.create({ data: { actorId: null, action: "RESOLVE_MANUAL_REVIEW_TASK_FALSE_POSITIVE", entityType: "ManualReviewTask", entityId: task.id, beforeJson: before, afterJson: after } });
    });
    console.log(`  LIVE: resolved.\n`);
  }

  console.log(`=== 3. DUPLICATE_CANONICALIZATION ===`);
  {
    const canonical = await prisma.foreclosureCase.findFirst({ where: { caseNumber: DUPLICATE_CANONICALIZATION.canonicalCaseNumber, archivedAt: null } });
    const duplicate = await prisma.foreclosureCase.findFirst({ where: { caseNumber: DUPLICATE_CANONICALIZATION.duplicateCaseNumber, archivedAt: null } });
    if (!canonical || !duplicate) {
      console.log(`SKIP: canonical=${Boolean(canonical)} duplicate=${Boolean(duplicate)} -- one or both not found/already archived.\n`);
    } else {
      const link = await prisma.possibleDuplicateNoticeLink.findFirst({
        where: {
          status: "OPEN",
          confidence: "CONFIRMED_SAME_EVENT",
          OR: [
            { caseAId: canonical.id, caseBId: duplicate.id },
            { caseAId: duplicate.id, caseBId: canonical.id },
          ],
        },
      });
      if (!link) {
        console.log(`SKIP: no OPEN CONFIRMED_SAME_EVENT PossibleDuplicateNoticeLink found between these two cases -- state changed since triage, not touching.\n`);
      } else {
        console.log(`Canonicalizing: ${DUPLICATE_CANONICALIZATION.canonicalCaseNumber} (canonical, id ${canonical.id}) <- ${DUPLICATE_CANONICALIZATION.duplicateCaseNumber} (archived, id ${duplicate.id})`);
        console.log(`Rationale: ${DUPLICATE_CANONICALIZATION.rationale}`);
        const linkBefore = { status: link.status, reviewedAt: link.reviewedAt, reviewNotes: link.reviewNotes };
        const linkAfter = { status: "CONFIRMED_DUPLICATE" as const, reviewedAt: new Date(), reviewNotes: DUPLICATE_CANONICALIZATION.rationale };
        const caseBefore = { archivedAt: duplicate.archivedAt, archivedReason: duplicate.archivedReason, mergedIntoCaseId: duplicate.mergedIntoCaseId, countyFilingNumber: duplicate.countyFilingNumber };
        const archivedReason = `Confirmed same foreclosure event as ${DUPLICATE_CANONICALIZATION.canonicalCaseNumber} (PossibleDuplicateNoticeLink ${link.id}, CONFIRMED_SAME_EVENT, score ${link.score}). ${DUPLICATE_CANONICALIZATION.rationale} Original county filing number: ${duplicate.countyFilingNumber}. Both source filings preserved; this case suppressed from public counts/listings only, never deleted.`;
        const caseAfter = { archivedAt: new Date(), archivedReason, mergedIntoCaseId: canonical.id, countyFilingNumber: null };
        if (DRY_RUN) {
          console.log(`  DRY RUN: no writes performed.\n`);
        } else {
          await prisma.$transaction(async (tx) => {
            await tx.possibleDuplicateNoticeLink.update({ where: { id: link.id }, data: linkAfter });
            await tx.auditLog.create({ data: { actorId: null, action: "CONFIRM_DUPLICATE_NOTICE_LINK", entityType: "PossibleDuplicateNoticeLink", entityId: link.id, beforeJson: linkBefore, afterJson: linkAfter } });
            await tx.foreclosureCase.update({ where: { id: duplicate.id }, data: caseAfter });
            await tx.auditLog.create({ data: { actorId: null, action: "ARCHIVE_AS_CONFIRMED_DUPLICATE_EVENT", entityType: "ForeclosureCase", entityId: duplicate.id, beforeJson: caseBefore, afterJson: caseAfter } });
            const dupTask = await tx.manualReviewTask.findFirst({ where: { foreclosureCaseId: duplicate.id, reason: "POSSIBLE_CONTENT_DUPLICATE", status: "OPEN" } });
            if (dupTask) {
              const taskAfter = { status: "RESOLVED" as const, notes: `${dupTask.notes ?? ""}\n\nConfirmed and archived as duplicate of canonical ${DUPLICATE_CANONICALIZATION.canonicalCaseNumber}.`.trim(), resolvedAt: new Date() };
              await tx.manualReviewTask.update({ where: { id: dupTask.id }, data: taskAfter });
              await tx.auditLog.create({ data: { actorId: null, action: "RESOLVE_MANUAL_REVIEW_TASK_DUPLICATE_CONFIRMED", entityType: "ManualReviewTask", entityId: dupTask.id, beforeJson: { status: dupTask.status, notes: dupTask.notes }, afterJson: taskAfter } });
            }
          });
          console.log(`  LIVE: canonicalized.\n`);
        }
      }
    }
  }

  console.log(`Done.`);
}

main()
  .catch((err) => {
    console.error("Resolution pass failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
