/**
 * Read-only cross-tabulation of the Phase 5 publication-status inventory
 * against the Phase 6 manual-review backlog triage, to explain why the two
 * reports' "non-public"/"blocking" counts don't match 1:1. Zero database
 * writes, zero Anthropic calls.
 *
 * Two structural reasons a case can be non-public WITHOUT appearing in the
 * task-bucketed backlog counts:
 *   1. WITHHELD (no ForeclosureSale row at all) has nothing to do with
 *      ManualReviewTask reasons -- a case can be WITHHELD with zero open
 *      tasks, invisible to a report that only iterates open tasks.
 *   2. PENDING_REVIEW via an active PossibleDuplicateNoticeLink is a
 *      structural check against a different table entirely, not a
 *      ManualReviewReason -- a case can be PENDING_REVIEW purely from a
 *      duplicate link with no corresponding task.
 * And one structural reason a case can appear in the triage backlog's
 * blocking buckets WITHOUT actually being non-public:
 *   3. The triage script's MISSING_DATA bucket for NO_ADDRESS_RESOLVED
 *      (zero CAD candidates) doesn't check for a legal description --
 *      but the publication model treats a legal description alone as a
 *      sufficient property identifier, so such a case can still be
 *      PUBLISHED_WITH_LIMITED_DATA despite being triage-bucketed as
 *      blocking.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

type Bucket = "QUICK_APPROVAL" | "MEANINGFUL_REVIEW" | "MISSING_DATA" | "NON_BLOCKING_ENRICHMENT" | "NONE";

const QUICK_APPROVAL_MARGIN = 0.15;

function bucketForTask(reason: string, candidates: Array<{ score: number | null }>): Exclude<Bucket, "NONE"> {
  if (reason === "MULTIPLE_APPRAISAL_MATCHES") {
    if (candidates.length === 0) return "MISSING_DATA";
    const sorted = [...candidates].map((c) => c.score ?? 0).sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    if (best - second >= QUICK_APPROVAL_MARGIN) return "QUICK_APPROVAL";
    return "MEANINGFUL_REVIEW";
  }
  if (reason === "NO_ADDRESS_RESOLVED") return candidates.length === 0 ? "MISSING_DATA" : "NON_BLOCKING_ENRICHMENT";
  if (["CAD_OWNER_CONFLICT", "BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT", "POSSIBLE_CONTENT_DUPLICATE"].includes(reason)) return "MEANINGFUL_REVIEW";
  if (["POOR_TEXT_QUALITY", "MISSING_FILING_NUMBER"].includes(reason)) return "MISSING_DATA";
  return "NON_BLOCKING_ENRICHMENT";
}

async function main() {
  console.log(`=== Inventory-vs-backlog reconciliation (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)`);
  console.log(`Scope: the 282 automated-ingestion cases (countyFilingNumber IS NOT NULL)\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { not: null } },
    include: {
      borrower: { select: { fullName: true } },
      property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
      sales: { select: { saleDate: true } },
      documents: { select: { id: true }, take: 1 },
      legalDescriptions: { select: { id: true }, take: 1 },
      manualReviewTasks: { where: { status: "OPEN" }, select: { reason: true } },
      appraisalCandidates: { select: { score: true, isSelected: true } },
      duplicateLinksAsCaseA: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
      duplicateLinksAsCaseB: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
    },
  });

  interface Row {
    caseNumber: string;
    status: string;
    blocks: boolean;
    highestBucket: Bucket;
    hasOpenTask: boolean;
  }
  const rows: Row[] = [];

  for (const c of cases) {
    const publicationInput: PublicationInput = {
      archivedAt: c.archivedAt,
      hasSourceDocument: c.documents.length > 0,
      saleDate: c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null,
      borrowerName: c.borrower?.fullName ?? null,
      propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
      addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
      addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
      hasLegalDescription: c.legalDescriptions.length > 0 || Boolean(c.property?.subdivision && c.property?.lot),
      hasCadConfirmedProperty: c.appraisalCandidates.some((a) => a.isSelected),
      openManualReviewReasons: c.manualReviewTasks.map((t) => t.reason),
      hasActiveDuplicateLink: c.duplicateLinksAsCaseA.length > 0 || c.duplicateLinksAsCaseB.length > 0,
    };
    const result = computePublicationStatus(publicationInput);
    const blocks = !isPubliclyVisibleStatus(result.status);

    const priority: Exclude<Bucket, "NONE">[] = ["MEANINGFUL_REVIEW", "MISSING_DATA", "QUICK_APPROVAL", "NON_BLOCKING_ENRICHMENT"];
    const bucketsForCase = new Set<Exclude<Bucket, "NONE">>();
    for (const task of c.manualReviewTasks) bucketsForCase.add(bucketForTask(task.reason, c.appraisalCandidates));
    const highestBucket: Bucket = priority.find((b) => bucketsForCase.has(b)) ?? "NONE";

    rows.push({ caseNumber: c.caseNumber ?? c.id, status: result.status, blocks, highestBucket, hasOpenTask: c.manualReviewTasks.length > 0 });
  }

  console.log(`=== Publication status counts (ground truth) ===`);
  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  console.log(JSON.stringify(statusCounts, null, 2));
  const nonPublicCount = rows.filter((r) => r.blocks).length;
  console.log(`Total non-public (blocks=true): ${nonPublicCount}\n`);

  console.log(`=== Triage backlog bucket counts (case-level, highest-priority bucket) ===`);
  const bucketCounts: Record<string, number> = {};
  for (const r of rows) bucketCounts[r.highestBucket] = (bucketCounts[r.highestBucket] ?? 0) + 1;
  console.log(JSON.stringify(bucketCounts, null, 2));
  const backlogBlockingCount = rows.filter((r) => r.highestBucket === "MEANINGFUL_REVIEW" || r.highestBucket === "MISSING_DATA").length;
  console.log(`Total in blocking buckets (MEANINGFUL_REVIEW + MISSING_DATA): ${backlogBlockingCount}\n`);

  console.log(`=== Cross-tab: publication status x triage bucket ===`);
  const crossTab: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const byStatus = (crossTab[r.status] ??= {});
    byStatus[r.highestBucket] = (byStatus[r.highestBucket] ?? 0) + 1;
  }
  console.log(JSON.stringify(crossTab, null, 2));
  console.log();

  console.log(`=== Non-public cases with NO open manual-review task at all (invisible to task-based triage) ===`);
  const nonPublicNoTask = rows.filter((r) => r.blocks && !r.hasOpenTask);
  console.log(`Count: ${nonPublicNoTask.length}`);
  console.log(nonPublicNoTask.map((r) => `${r.caseNumber} (${r.status})`));
  console.log();

  console.log(`=== Cases in a blocking triage bucket (MEANINGFUL_REVIEW/MISSING_DATA) that are NOT actually non-public ===`);
  const bucketedButPublic = rows.filter((r) => (r.highestBucket === "MEANINGFUL_REVIEW" || r.highestBucket === "MISSING_DATA") && !r.blocks);
  console.log(`Count: ${bucketedButPublic.length}`);
  console.log(bucketedButPublic.map((r) => `${r.caseNumber} (${r.status}, bucket=${r.highestBucket})`));
  console.log();

  console.log(`=== PENDING_REVIEW/WITHHELD cases with no MEANINGFUL_REVIEW/MISSING_DATA bucket (blocked but invisible to backlog triage) ===`);
  const blockedButNotBucketed = rows.filter((r) => r.blocks && r.highestBucket !== "MEANINGFUL_REVIEW" && r.highestBucket !== "MISSING_DATA");
  console.log(`Count: ${blockedButNotBucketed.length}`);
  console.log(blockedButNotBucketed.map((r) => `${r.caseNumber} (${r.status}, bucket=${r.highestBucket}, hasOpenTask=${r.hasOpenTask})`));

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Reconciliation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
