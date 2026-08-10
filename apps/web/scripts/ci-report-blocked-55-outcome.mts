/**
 * Phase 7 + Phase 8 of the 55-case publication-blocker triage: recalculates
 * investor-visible inventory after the Phase 5/6 safe resolution pass, and
 * separates the remaining review workload into PUBLICATION-BLOCKING vs
 * NON-BLOCKING QA vs DUPLICATE-EVENT REVIEW. Read-only, zero writes, zero
 * Anthropic calls.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

const ORIGINAL_55 = [
  "HID-117631", "HID-118005", "HID-117634", "HID-117643", "HID-117651", "HID-117652", "HID-117658", "HID-117660", "HID-117661",
  "HID-117675", "HID-117697", "HID-117698", "HID-117695", "HID-117701", "HID-117702", "HID-117718", "HID-117888", "HID-117908",
  "HID-117915", "HID-117913", "HID-117919", "HID-117921", "HID-118016", "HID-118014", "HID-117932", "HID-117933", "HID-117935",
  "HID-117944", "HID-117959", "HID-117961", "HID-117962", "HID-117988", "HID-117989", "HID-117997", "HID-118000", "HID-118055",
  "HID-118067", "HID-118069", "HID-118087", "HID-118094", "HID-118149", "HID-118116", "HID-118125", "HID-118124", "HID-118128",
  "HID-118150", "HID-118147", "HID-118151", "HID-118152", "HID-118154", "HID-118163", "HID-118153", "HID-118176", "HID-117731",
  "HID-117729",
];

async function main() {
  console.log(`=== Blocked-55 outcome report (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  console.log(`=== ForeclosureCase counts (full table) ===`);
  const total = await prisma.foreclosureCase.count();
  const active = await prisma.foreclosureCase.count({ where: { archivedAt: null } });
  const archived = await prisma.foreclosureCase.count({ where: { archivedAt: { not: null } } });
  console.log(`Total: ${total} | Active: ${active} | Archived: ${archived}\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { not: null }, archivedAt: null },
    include: {
      borrower: { select: { fullName: true } },
      property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
      sales: { select: { saleDate: true } },
      documents: { select: { id: true }, take: 1 },
      legalDescriptions: { select: { id: true }, take: 1 },
      manualReviewTasks: { where: { status: "OPEN" }, select: { reason: true } },
      appraisalCandidates: { select: { isSelected: true } },
      duplicateLinksAsCaseA: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
      duplicateLinksAsCaseB: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
    },
  });

  const statusCounts: Record<string, number> = {};
  let addressPendingCount = 0;
  let stillBlockedOriginal55: string[] = [];
  let nowVisibleOriginal55: string[] = [];

  for (const c of cases) {
    const saleDate = c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null;
    const input: PublicationInput = {
      archivedAt: c.archivedAt,
      hasSourceDocument: c.documents.length > 0,
      saleDate,
      borrowerName: c.borrower?.fullName ?? null,
      propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
      addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
      addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
      hasLegalDescription: c.legalDescriptions.length > 0 || Boolean(c.property?.subdivision && c.property?.lot),
      hasCadConfirmedProperty: c.appraisalCandidates.some((a) => a.isSelected),
      openManualReviewReasons: c.manualReviewTasks.map((t) => t.reason),
      hasActiveDuplicateLink: c.duplicateLinksAsCaseA.length > 0 || c.duplicateLinksAsCaseB.length > 0,
    };
    const result = computePublicationStatus(input);
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    if (result.addressPending) addressPendingCount++;

    if (ORIGINAL_55.includes(c.caseNumber ?? "")) {
      if (isPubliclyVisibleStatus(result.status)) nowVisibleOriginal55.push(`${c.caseNumber} -> ${result.status}`);
      else stillBlockedOriginal55.push(`${c.caseNumber} -> ${result.status} (${result.blockingReasons.join(",")})`);
    }
  }

  const duplicateSuppressedCount = await prisma.foreclosureCase.count({ where: { archivedAt: { not: null }, archivedReason: { contains: "Confirmed same foreclosure event" } } });
  const uniqueForeclosureEvents = active - duplicateSuppressedCount; // active non-archived rows minus rows we've confirmed represent an already-counted event

  console.log(`=== Recalculated inventory (282 automated-ingestion scope) ===`);
  console.log(`Source notices represented: 282`);
  console.log(`Active ForeclosureCase rows (all scopes): ${active}`);
  console.log(`By publication status: ${JSON.stringify(statusCounts, null, 2)}`);
  console.log(`Investor-visible listings (PUBLISHED + PUBLISHED_WITH_LIMITED_DATA): ${(statusCounts.PUBLISHED ?? 0) + (statusCounts.PUBLISHED_WITH_LIMITED_DATA ?? 0)}`);
  console.log(`Address-pending among visible listings: ${addressPendingCount}`);
  console.log(`Duplicate-suppressed source records (archived via confirmed-same-event canonicalization): ${duplicateSuppressedCount}`);
  console.log(`Unique foreclosure events (active rows minus confirmed-duplicate-suppressed): ${uniqueForeclosureEvents}\n`);

  console.log(`=== Original-55 outcome ===`);
  console.log(`Now investor-visible (${nowVisibleOriginal55.length}):`);
  console.log(nowVisibleOriginal55);
  console.log(`Still blocked (${stillBlockedOriginal55.length}):`);
  console.log(stillBlockedOriginal55);
  console.log();

  console.log(`=== Backlog separation (structural, not task-reason heuristic) ===`);
  let publicationBlockingCases = 0;
  let publicationBlockingTasks = 0;
  let nonBlockingQaCases = 0;
  let nonBlockingQaTasks = 0;
  let duplicateReviewCases = 0;
  let duplicateReviewTasks = 0;
  const CRITICAL = new Set(["CAD_OWNER_CONFLICT", "BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT", "MISSING_FILING_NUMBER", "POSSIBLE_CONTENT_DUPLICATE", "POOR_TEXT_QUALITY"]);
  for (const c of cases) {
    const saleDate = c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null;
    const input: PublicationInput = {
      archivedAt: c.archivedAt,
      hasSourceDocument: c.documents.length > 0,
      saleDate,
      borrowerName: c.borrower?.fullName ?? null,
      propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
      addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
      addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
      hasLegalDescription: c.legalDescriptions.length > 0 || Boolean(c.property?.subdivision && c.property?.lot),
      hasCadConfirmedProperty: c.appraisalCandidates.some((a) => a.isSelected),
      openManualReviewReasons: c.manualReviewTasks.map((t) => t.reason),
      hasActiveDuplicateLink: c.duplicateLinksAsCaseA.length > 0 || c.duplicateLinksAsCaseB.length > 0,
    };
    const result = computePublicationStatus(input);
    const blocks = !isPubliclyVisibleStatus(result.status);
    const hasDupTask = c.manualReviewTasks.some((t) => t.reason === "POSSIBLE_CONTENT_DUPLICATE") || input.hasActiveDuplicateLink;

    if (blocks && hasDupTask) {
      duplicateReviewCases++;
      duplicateReviewTasks += c.manualReviewTasks.filter((t) => t.reason === "POSSIBLE_CONTENT_DUPLICATE").length + (input.hasActiveDuplicateLink ? 1 : 0);
    } else if (blocks) {
      publicationBlockingCases++;
      publicationBlockingTasks += c.manualReviewTasks.filter((t) => CRITICAL.has(t.reason)).length;
    } else if (c.manualReviewTasks.length > 0) {
      nonBlockingQaCases++;
      nonBlockingQaTasks += c.manualReviewTasks.length;
    }
  }
  console.log(`PUBLICATION-BLOCKING: ${publicationBlockingCases} cases, ${publicationBlockingTasks} tasks`);
  console.log(`NON-BLOCKING QA (already visible, has open task): ${nonBlockingQaCases} cases, ${nonBlockingQaTasks} tasks`);
  console.log(`DUPLICATE-EVENT REVIEW: ${duplicateReviewCases} cases, ${duplicateReviewTasks} tasks`);

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Outcome report failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
