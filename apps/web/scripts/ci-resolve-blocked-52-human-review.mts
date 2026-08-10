/**
 * Phase 1 execution of the Hidalgo beta-readiness pass: applies the
 * human-review findings from reading the full source-notice text of all
 * 52 still-blocked cases (via ci-deepdump-blocked-52.mts). Every action
 * below is backed by text directly, unambiguously stated in that case's
 * own notice -- never a guess, never invented. Cases where the notice
 * itself doesn't state the missing fact (references an unattached
 * Exhibit A/B, or a genuinely illegible/absent section) are left
 * untouched and stay withheld/pending.
 *
 * Five action groups:
 *
 * 1. SALE_DATE_BACKFILLS (14) -- these cases had NO ForeclosureSale row
 *    at all (sales=[]), yet every one of their notices states "Tuesday,
 *    the 4th day of August, 2026" (or an equivalent unambiguous phrasing)
 *    in its own "Date of Sale"/"DATE, TIME, PLACE OF SALE" section. The
 *    deterministic extractor's date regex didn't match these particular
 *    template phrasings (two different templates across the 14, both
 *    manually confirmed). Creates the missing ForeclosureSale row.
 *
 * 2. STALE_TASK_CLOSURES (9) -- BORROWER_NAME_CONFLICT (and, for 4 of
 *    these, SALE_DATE_CONFLICT too) was raised at the deterministic
 *    extraction layer, but the case's stored borrower name is already a
 *    real, single, unambiguous name that appears identically 2-3+ times
 *    throughout the notice with zero competing candidate -- and for the
 *    4 combined cases, the ForeclosureSale row already has the correct
 *    2026-08-04 date. No mutation to case data; only closes the stale
 *    task(s).
 *
 * 3. BORROWER_NAME_BACKFILLS (11) -- these cases show the "Unknown
 *    owner" placeholder because deterministic borrower-name extraction
 *    failed outright, but the real grantor/borrower name is stated
 *    plainly in the notice (usually right after "Grantor(s):" or "with
 *    [Name] as Grantor(s)"), consistently, with no second candidate.
 *
 * 4. LEGAL_DESCRIPTION_BACKFILLS (9) -- these cases show no address AND
 *    no legal description in the database, but the notice's own
 *    "Property:"/"Property To Be Sold." section states one plainly. For
 *    8 of the 9, a CAD candidate's legalDescription/subdivision/lot/
 *    block matches the notice's stated legal description exactly AND its
 *    ownerName matches the notice's grantor name (allowing for normal
 *    name-order variation) -- for those, the matching candidate is also
 *    approved (isSelected) so the case gains a CAD-confirmed address, not
 *    just a legal description. The 9th (HID-118067, two adjacent lots
 *    split across two CAD parcel records) gets the legal description
 *    only -- no single candidate represents the whole property, so no
 *    candidate is force-selected.
 *
 * Left untouched (see the beta-readiness report for the full case list
 * and reasoning): HID-117631/HID-117695 (CAD_OWNER_CONFLICT with no
 * independent way to resolve which record is right -- the codebase's own
 * documented design says never auto-accept this), HID-117962 (zero CAD
 * candidates, zero legal description, nothing to work with), HID-117915
 * (notice text has no discoverable sale date -- likely an OCR/rendering
 * defect, not something to invent a date for), and 5 cases whose
 * "Property:" section says only "See Exhibit A/B attached hereto" with
 * no legal description restated in the notice body.
 *
 * DRY_RUN=true (default): zero writes. DRY_RUN=false: executes, with an
 * AuditLog before/after entry for every row touched.
 */
import { prisma } from "@foreclosuredata/database";

const DRY_RUN = process.env.DRY_RUN !== "false";
const SALE_DATE = new Date("2026-08-04T00:00:00.000Z");

const SALE_DATE_BACKFILLS = [
  "HID-117652", "HID-117702", "HID-117913", "HID-117935", "HID-117988", "HID-117989",
  "HID-118147", "HID-118149", "HID-118150", "HID-118151", "HID-118152", "HID-118153", "HID-118154",
  "HID-118000",
];

const STALE_TASK_CLOSURES: Array<{ caseNumber: string; reasons: string[]; note: string }> = [
  { caseNumber: "HID-117634", reasons: ["BORROWER_NAME_CONFLICT"], note: "Notice text states \"Damian Davila, single man as Grantor(s)\" identically 3 times, no competing name." },
  { caseNumber: "HID-117651", reasons: ["BORROWER_NAME_CONFLICT"], note: "Notice text states \"EDIBERTO REYES, JR. AN UNMARRIED MAN\" as Grantor(s)/Mortgagor(s), no competing name." },
  { caseNumber: "HID-117658", reasons: ["BORROWER_NAME_CONFLICT"], note: "Notice text states \"Ismael E. Badillo, a single man as Grantor(s)\" identically 3 times, no competing name." },
  { caseNumber: "HID-117660", reasons: ["BORROWER_NAME_CONFLICT"], note: "Notice text states \"GERARDO GUERRERO DIAZ AN UNMARRIED MAN, grantor(s)\", no competing name." },
  { caseNumber: "HID-117698", reasons: ["BORROWER_NAME_CONFLICT"], note: "Notice text states the grantor name matching the stored value, no competing name." },
  { caseNumber: "HID-117643", reasons: ["BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT"], note: "Notice states \"ROBERT ANTHONY CUMMINGS AND FRANCISCA CANNATA\" as obligor with no competing name; ForeclosureSale row already has 2026-08-04 (notice states \"Date. 08042026\")." },
  { caseNumber: "HID-117697", reasons: ["BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT"], note: "Notice states \"EDUARDO CASTELLANOS\" as obligor with no competing name; ForeclosureSale row already has 2026-08-04." },
  { caseNumber: "HID-117701", reasons: ["BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT"], note: "Notice states \"RUBEN RODRIGUEZ CAVAZOS, A SINGLE MAN, as Grantor(s)\" with no competing name; ForeclosureSale row already has 2026-08-04." },
  { caseNumber: "HID-117888", reasons: ["BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT"], note: "Notice states \"...VARGAS A/K/A OLIVIA M. VARGAS, A SINGLE PERSON, ('Mortgagor')\" matching the stored co-borrower name with no competing name; ForeclosureSale row already has 2026-08-04." },
];

const BORROWER_NAME_BACKFILLS: Array<{ caseNumber: string; realName: string; evidence: string }> = [
  { caseNumber: "HID-118005", realName: "Elva Pesina", evidence: "Notice text: \"ELVA PESINA, grantor(s)\"." },
  { caseNumber: "HID-117661", realName: "Gabriel Sanchez and Elvia Sanchez", evidence: "Notice text: \"GABRIEL SANCHEZ AND ELVIA SANCHEZ, grantor(s)\"." },
  { caseNumber: "HID-117718", realName: "Flipping J & J LLC, a Texas limited liability company", evidence: "Notice text: \"FLIPPING J & J LLC, A TEXAAS LIMITED LIABILITY COMPANY grantor(s)\" (entity name is clear; \"TEXAAS\" is a typo in the source notice for \"TEXAS\", appears identically twice)." },
  { caseNumber: "HID-117919", realName: "Carlos Hernandez and Zaira Hernandez", evidence: "Notice text: \"CARLOS HERNANDEZ AND ZAIRA HERNANDEZ, HUSBAND AND WIFE, grantor(s)\"." },
  { caseNumber: "HID-117921", realName: "Venian Lau Olivas and Waippy Uriarte Cruz", evidence: "Notice text: \"VENIAN LAU OLIVAS AND WAIPPY URIARTE CRUZ, HUSBAND AND WIFE, grantor(s)\", repeated identically in the Obligations Secured section." },
  { caseNumber: "HID-117932", realName: "AGD, L.P., a Texas limited partnership", evidence: "Notice text: \"Trustor(s): AGD, L.P., a Texas limited partnership\"." },
  { caseNumber: "HID-117933", realName: "AGD, L.P., a Texas limited partnership", evidence: "Notice text: \"Trustor(s): AGD, L.P., a Texas limited partnership\" (companion filing to HID-117932, adjacent commercial address, different Document No.)." },
  { caseNumber: "HID-117959", realName: "Horacio Vargas and Olga Vargas aka Olga Santos Vargas", evidence: "Notice text: \"HARACIO VARGAS AND OLGA VARGAS AKA OLGA SANTOS VARGAS\" -- \"Horacio\" spelling corrected from an evident single-character OCR drop, cross-confirmed by the CAD owner-of-record \"VARGAS OLGA & HORACIO\" at the same subdivision/lot." },
  { caseNumber: "HID-118094", realName: "George Ontiveros, Jr.", evidence: "Notice text (Mechanic's Lien foreclosure): \"the Mechanic's Lien Note...executed by George Ontiveros, Jr.\", stated twice." },
  { caseNumber: "HID-118163", realName: "Maria del Carmen Bolanos Hernandez", evidence: "Notice text: \"Grantor(s): Maria del Carmen Bolanos Hernandez\"." },
  { caseNumber: "HID-118176", realName: "Sulema Flores Villegas & Rogelio Gaona Gaona", evidence: "Notice text: \"Grantor(s): Sulema Flores Villegas & Rogelio Gaona Gaona\"." },
];

interface LegalDescBackfill {
  caseNumber: string;
  rawText: string;
  subdivision: string;
  lot: string;
  block: string | null;
  approveCandidateParcelId: string | null;
}

const LEGAL_DESCRIPTION_BACKFILLS: LegalDescBackfill[] = [
  { caseNumber: "HID-118016", rawText: "Lots 31 and 32, Block 27, North Elsa Re-Subdivision, Hidalgo County, Texas, according to the map or plat thereof recorded in Volume 7, Page 21, Map Records of Hidalgo County, Texas.", subdivision: "North Elsa Re-Subdivision", lot: "31 & 32", block: "27", approveCandidateParcelId: "169402" },
  { caseNumber: "HID-117944", rawText: "Lot(s) 89 Gloria Vista Subdivision Phase 1, an addition to the City of Hidalgo, as shown by the map or plat thereof recorded in Volume 51, Page 134 of the map records of Hidalgo County, Texas.", subdivision: "Gloria Vista Subdivision Phase 1", lot: "89", block: null, approveCandidateParcelId: "711439" },
  { caseNumber: "HID-117961", rawText: "Lot(s) 34, Elite Village Subdivision Phase II, as shown by the map or plat thereof filed for record in the Office of the County Clerk of Hidalgo County, Texas under Clerk's File Number 2239313.", subdivision: "Elite Village Subdivision Phase II", lot: "34", block: null, approveCandidateParcelId: "816872" },
  { caseNumber: "HID-118055", rawText: "Lots 6, 7 and 8, Block 11, Colonia Juarez Subdivision, a subdivision to the Townsite of Edcouch, Hidalgo County, Texas, according to the map or plat thereof recorded in Volume 6, Page 21, Map Records of Hidalgo County, Texas.", subdivision: "Colonia Juarez Subdivision", lot: "6, 7 & 8", block: "11", approveCandidateParcelId: "151778" },
  { caseNumber: "HID-118125", rawText: "Lots 1 and 2, Block 1, Original Townsite to the City of Edcouch, Hidalgo County, Texas, as described in Volume 1242, Page 778, Deed Records of Hidalgo County, Texas.", subdivision: "Original Townsite to the City of Edcouch", lot: "1 & 2", block: "1", approveCandidateParcelId: "163338" },
  { caseNumber: "HID-118124", rawText: "Lot(s) 35, La Frontera Estates Phase II, as shown by the map or plat thereof recorded in Volume 54, Page 197-199, Map Records of Hidalgo County, Texas.", subdivision: "La Frontera Estates Phase II", lot: "35", block: null, approveCandidateParcelId: "725446" },
  { caseNumber: "HID-117675", rawText: "Lot 130, Shary Estates Subdivision Phase II, an addition to the City of Alton.", subdivision: "Shary Estates Subdivision Phase II", lot: "130", block: null, approveCandidateParcelId: "1463688" },
  { caseNumber: "HID-117908", rawText: "All of Lots 17 and 18, Block 3, Enfield Estates, an addition to the City of Edinburg, Hidalgo County, Texas, according to the map recorded in Volume 4, Page 27, Map Records.", subdivision: "Enfield Estates", lot: "17 & 18", block: "3", approveCandidateParcelId: "170610" },
  { caseNumber: "HID-118067", rawText: "Lots 218 & 219, Carmen Avila Subdivision, Phase II, Hidalgo County, Texas, according to the map or plat thereof recorded as Document No. 3094102 in the Official Records of Hidalgo County, Texas.", subdivision: "Carmen Avila Subdivision Phase II", lot: "218 & 219", block: null, approveCandidateParcelId: null },
];

async function main() {
  console.log(`=== Blocked-52 human-review resolution pass (${new Date().toISOString()}) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (zero writes)" : "LIVE (will mutate production)"}\n`);

  console.log(`=== 1. SALE_DATE_BACKFILLS (${SALE_DATE_BACKFILLS.length}) ===`);
  for (const caseNumber of SALE_DATE_BACKFILLS) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber, archivedAt: null }, include: { sales: true, documents: { select: { id: true }, take: 1 } } });
    if (!fc) { console.log(`SKIP ${caseNumber}: not found.\n`); continue; }
    if (fc.sales.length > 0) { console.log(`SKIP ${caseNumber}: already has a ForeclosureSale row -- state changed since review, not touching.\n`); continue; }
    console.log(`${caseNumber}: creating ForeclosureSale row, saleDate=2026-08-04 (clearly stated in notice text).`);
    if (DRY_RUN) { console.log(`  DRY RUN: no writes performed.\n`); continue; }
    await prisma.$transaction(async (tx) => {
      const sale = await tx.foreclosureSale.create({ data: { foreclosureCaseId: fc.id, saleDate: SALE_DATE, saleStatus: "SCHEDULED", sourceDocumentId: fc.documents[0]?.id } });
      await tx.auditLog.create({ data: { actorId: null, action: "BACKFILL_SALE_DATE_FROM_NOTICE_TEXT", entityType: "ForeclosureSale", entityId: sale.id, beforeJson: { existed: false }, afterJson: { saleDate: SALE_DATE.toISOString() } } });
    });
    console.log(`  LIVE: created.\n`);
  }

  console.log(`=== 2. STALE_TASK_CLOSURES (${STALE_TASK_CLOSURES.length}) ===`);
  for (const c of STALE_TASK_CLOSURES) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: c.caseNumber, archivedAt: null } });
    if (!fc) { console.log(`SKIP ${c.caseNumber}: not found.\n`); continue; }
    for (const reason of c.reasons) {
      const task = await prisma.manualReviewTask.findFirst({ where: { foreclosureCaseId: fc.id, reason: reason as never, status: "OPEN" } });
      if (!task) { console.log(`SKIP ${c.caseNumber}/${reason}: no matching OPEN task.\n`); continue; }
      const before = { status: task.status, notes: task.notes };
      const after = { status: "RESOLVED" as const, notes: `${task.notes ?? ""}\n\nResolved via full-text human review: ${c.note}`.trim(), resolvedAt: new Date() };
      console.log(`${c.caseNumber}/${reason}: closing task ${task.id}. ${c.note}`);
      if (DRY_RUN) { console.log(`  DRY RUN: no writes performed.\n`); continue; }
      await prisma.$transaction(async (tx) => {
        await tx.manualReviewTask.update({ where: { id: task.id }, data: after });
        await tx.auditLog.create({ data: { actorId: null, action: "RESOLVE_MANUAL_REVIEW_TASK_HUMAN_REVIEW", entityType: "ManualReviewTask", entityId: task.id, beforeJson: before, afterJson: after } });
      });
      console.log(`  LIVE: resolved.\n`);
    }
  }

  console.log(`=== 3. BORROWER_NAME_BACKFILLS (${BORROWER_NAME_BACKFILLS.length}) ===`);
  for (const b of BORROWER_NAME_BACKFILLS) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: b.caseNumber, archivedAt: null }, include: { borrower: true, grantor: true } });
    if (!fc) { console.log(`SKIP ${b.caseNumber}: not found.\n`); continue; }
    if (fc.borrower?.fullName?.trim().toLowerCase() !== "unknown owner") { console.log(`SKIP ${b.caseNumber}: borrower is no longer the placeholder -- state changed since review, not touching.\n`); continue; }
    console.log(`${b.caseNumber}: backfilling borrower/grantor name -> "${b.realName}". ${b.evidence}`);
    const task = await prisma.manualReviewTask.findFirst({ where: { foreclosureCaseId: fc.id, reason: "BORROWER_NAME_CONFLICT", status: "OPEN" } });
    if (DRY_RUN) { console.log(`  DRY RUN: no writes performed.\n`); continue; }
    await prisma.$transaction(async (tx) => {
      if (fc.borrowerPersonId) {
        const before = { fullName: fc.borrower?.fullName };
        await tx.person.update({ where: { id: fc.borrowerPersonId }, data: { fullName: b.realName } });
        await tx.auditLog.create({ data: { actorId: null, action: "BACKFILL_BORROWER_NAME_FROM_NOTICE_TEXT", entityType: "Person", entityId: fc.borrowerPersonId, beforeJson: before, afterJson: { fullName: b.realName, evidence: b.evidence } } });
      }
      if (fc.grantorPersonId && fc.grantorPersonId !== fc.borrowerPersonId) {
        const before = { fullName: fc.grantor?.fullName };
        await tx.person.update({ where: { id: fc.grantorPersonId }, data: { fullName: b.realName } });
        await tx.auditLog.create({ data: { actorId: null, action: "BACKFILL_BORROWER_NAME_FROM_NOTICE_TEXT", entityType: "Person", entityId: fc.grantorPersonId, beforeJson: before, afterJson: { fullName: b.realName, evidence: b.evidence } } });
      }
      if (task) {
        const before = { status: task.status, notes: task.notes };
        const after = { status: "RESOLVED" as const, notes: `${task.notes ?? ""}\n\nResolved via full-text human review: backfilled real name. ${b.evidence}`.trim(), resolvedAt: new Date() };
        await tx.manualReviewTask.update({ where: { id: task.id }, data: after });
        await tx.auditLog.create({ data: { actorId: null, action: "RESOLVE_MANUAL_REVIEW_TASK_HUMAN_REVIEW", entityType: "ManualReviewTask", entityId: task.id, beforeJson: before, afterJson: after } });
      }
    });
    console.log(`  LIVE: backfilled.\n`);
  }

  console.log(`=== 4. LEGAL_DESCRIPTION_BACKFILLS (${LEGAL_DESCRIPTION_BACKFILLS.length}) ===`);
  for (const l of LEGAL_DESCRIPTION_BACKFILLS) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: l.caseNumber, archivedAt: null }, include: { property: true, documents: { select: { id: true }, take: 1 }, legalDescriptions: { select: { id: true }, take: 1 }, manualReviewTasks: { where: { status: "OPEN", reason: "NO_ADDRESS_RESOLVED" } } } });
    if (!fc) { console.log(`SKIP ${l.caseNumber}: not found.\n`); continue; }
    if (fc.legalDescriptions.length > 0) { console.log(`SKIP ${l.caseNumber}: already has a LegalDescription row -- state changed since review, not touching.\n`); continue; }
    let candidate: { id: string; ownerName: string | null; situsAddress: string | null; parcelId: string | null; geographicId: string | null; legalDescription: string | null; subdivision: string | null; lot: string | null; block: string | null } | null = null;
    if (l.approveCandidateParcelId) {
      candidate = await prisma.appraisalPropertyCandidate.findFirst({ where: { foreclosureCaseId: fc.id, parcelId: l.approveCandidateParcelId } });
      if (!candidate) console.log(`  NOTE ${l.caseNumber}: expected CAD candidate parcel ${l.approveCandidateParcelId} not found -- will backfill legal description only.`);
    }
    console.log(`${l.caseNumber}: creating LegalDescription row (${l.subdivision}, Lot ${l.lot}${l.block ? `, Block ${l.block}` : ""}) from notice text.${candidate ? ` Approving matching CAD candidate ${candidate.id} (${candidate.ownerName}, ${candidate.situsAddress}).` : ""}`);
    if (DRY_RUN) { console.log(`  DRY RUN: no writes performed.\n`); continue; }
    await prisma.$transaction(async (tx) => {
      await tx.legalDescription.create({ data: { foreclosureCaseId: fc.id, sourceDocumentId: fc.documents[0]?.id, rawText: l.rawText, subdivision: l.subdivision, lot: l.lot, block: l.block } });
      const propertyBefore = fc.property ? { subdivision: fc.property.subdivision, lot: fc.property.lot, block: fc.property.block, propertyStreetAddress: fc.property.propertyStreetAddress, addressResolutionMethod: fc.property.addressResolutionMethod, addressResolutionConfidence: fc.property.addressResolutionConfidence } : null;
      const propertyAfter = candidate
        ? { subdivision: candidate.subdivision ?? l.subdivision, lot: candidate.lot ?? l.lot, block: candidate.block ?? l.block, propertyStreetAddress: candidate.situsAddress, propertyIdNumber: candidate.parcelId, geographicId: candidate.geographicId, addressResolutionMethod: "LEGAL_DESCRIPTION_MATCH" as const, addressResolutionConfidence: 0.9, addressResolutionExplanation: `CAD candidate parcel ${candidate.parcelId} legal description matches the notice's stated legal description exactly; owner name matches the notice's grantor. Approved via blocked-52 human review.` }
        : { subdivision: l.subdivision, lot: l.lot, block: l.block };
      if (fc.property) {
        await tx.property.update({ where: { id: fc.property.id }, data: propertyAfter });
      } else if (fc.propertyId === null) {
        const newProperty = await tx.property.create({ data: { countyId: fc.countyId, ...propertyAfter } });
        await tx.foreclosureCase.update({ where: { id: fc.id }, data: { propertyId: newProperty.id } });
      }
      await tx.auditLog.create({ data: { actorId: null, action: "BACKFILL_LEGAL_DESCRIPTION_FROM_NOTICE_TEXT", entityType: "Property", entityId: fc.propertyId ?? fc.id, beforeJson: propertyBefore ?? {}, afterJson: propertyAfter } });
      if (candidate) {
        await tx.appraisalPropertyCandidate.update({ where: { id: candidate.id }, data: { isSelected: true } });
        await tx.auditLog.create({ data: { actorId: null, action: "APPROVE_CAD_CANDIDATE_HUMAN_REVIEW", entityType: "AppraisalPropertyCandidate", entityId: candidate.id, beforeJson: { isSelected: false }, afterJson: { isSelected: true } } });
      }
      for (const task of fc.manualReviewTasks) {
        const before = { status: task.status, notes: task.notes };
        const after = { status: "RESOLVED" as const, notes: `${task.notes ?? ""}\n\nResolved via full-text human review: legal description backfilled from notice text.`.trim(), resolvedAt: new Date() };
        await tx.manualReviewTask.update({ where: { id: task.id }, data: after });
        await tx.auditLog.create({ data: { actorId: null, action: "RESOLVE_MANUAL_REVIEW_TASK_HUMAN_REVIEW", entityType: "ManualReviewTask", entityId: task.id, beforeJson: before, afterJson: after } });
      }
    });
    console.log(`  LIVE: backfilled.\n`);
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
