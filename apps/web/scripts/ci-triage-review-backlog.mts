/**
 * Read-only triage of the manual-review backlog (Phase 6 of the
 * productization pass) into four buckets so a human can spend time on the
 * highest-value work first instead of clearing 246 tasks in creation order:
 *
 *   QUICK_APPROVAL       - one dominant CAD candidate, safe to one-click confirm
 *   MEANINGFUL_REVIEW     - a real identity/data conflict, needs a human comparison
 *   MISSING_DATA          - no candidate/no usable source info to review at all
 *   NON_BLOCKING_ENRICHMENT - optional gap that never blocked publication
 *
 * Scope matches the Phase 5 report: the 282 automated-ingestion cases
 * (countyFilingNumber IS NOT NULL). Zero database writes, zero Anthropic
 * calls.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

type Bucket = "QUICK_APPROVAL" | "MEANINGFUL_REVIEW" | "MISSING_DATA" | "NON_BLOCKING_ENRICHMENT";

const QUICK_APPROVAL_SCORE_FLOOR = 0.9;
const QUICK_APPROVAL_MARGIN = 0.1;

function bucketForTask(reason: string, candidates: Array<{ score: number | null }>): Bucket {
  if (reason === "MULTIPLE_APPRAISAL_MATCHES") {
    if (candidates.length === 0) return "MISSING_DATA";
    const sorted = [...candidates].map((c) => c.score ?? 0).sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const second = sorted[1];
    if (best >= QUICK_APPROVAL_SCORE_FLOOR && (second === undefined || best - second >= QUICK_APPROVAL_MARGIN)) return "QUICK_APPROVAL";
    return "MEANINGFUL_REVIEW";
  }
  if (reason === "NO_ADDRESS_RESOLVED") {
    return candidates.length === 0 ? "MISSING_DATA" : "NON_BLOCKING_ENRICHMENT";
  }
  if (["CAD_OWNER_CONFLICT", "BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT", "POSSIBLE_CONTENT_DUPLICATE"].includes(reason)) {
    return "MEANINGFUL_REVIEW";
  }
  if (["POOR_TEXT_QUALITY", "MISSING_FILING_NUMBER"].includes(reason)) {
    return "MISSING_DATA";
  }
  // PROPERTY_CLASSIFICATION_UNCERTAIN, LOW_CONFIDENCE, USER_REPORTED
  return "NON_BLOCKING_ENRICHMENT";
}

async function main() {
  console.log(`=== Manual-review backlog triage (${new Date().toISOString()}) ===`);
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

  const casesWithTasks = cases.filter((c) => c.manualReviewTasks.length > 0);
  console.log(`Cases with >=1 open manual-review task: ${casesWithTasks.length}`);
  const totalTasks = casesWithTasks.reduce((sum, c) => sum + c.manualReviewTasks.length, 0);
  console.log(`Total open manual-review tasks: ${totalTasks}\n`);

  const taskBucketCounts: Record<Bucket, number> = { QUICK_APPROVAL: 0, MEANINGFUL_REVIEW: 0, MISSING_DATA: 0, NON_BLOCKING_ENRICHMENT: 0 };
  const caseFilingByBucket: Record<Bucket, string[]> = { QUICK_APPROVAL: [], MEANINGFUL_REVIEW: [], MISSING_DATA: [], NON_BLOCKING_ENRICHMENT: [] };

  for (const c of casesWithTasks) {
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
    const blocks = !computePublicationStatus(publicationInput).status.startsWith("PUBLISHED");
    const bucketsForCase = new Set<Bucket>();
    for (const task of c.manualReviewTasks) {
      const bucket = bucketForTask(task.reason, c.appraisalCandidates);
      taskBucketCounts[bucket]++;
      bucketsForCase.add(bucket);
    }
    // A case can land in more than one bucket (multiple tasks); for the
    // case-level "highest priority bucket present" list, rank
    // MEANINGFUL_REVIEW > MISSING_DATA > QUICK_APPROVAL > NON_BLOCKING.
    const priority: Bucket[] = ["MEANINGFUL_REVIEW", "MISSING_DATA", "QUICK_APPROVAL", "NON_BLOCKING_ENRICHMENT"];
    const primary = priority.find((b) => bucketsForCase.has(b))!;
    caseFilingByBucket[primary].push(`${c.caseNumber}${blocks ? "" : " (already publicly visible)"}`);
  }

  console.log(`=== Task-level bucket counts ===`);
  for (const [bucket, count] of Object.entries(taskBucketCounts)) {
    console.log(`  ${bucket}: ${count} tasks`);
  }
  console.log();

  console.log(`=== Case-level bucket counts (each case counted once, by its highest-priority bucket) ===`);
  const effort: Record<Bucket, string> = {
    QUICK_APPROVAL: "~15 sec/case (one-click confirm the dominant CAD candidate)",
    MEANINGFUL_REVIEW: "~3-5 min/case (compare conflicting candidates/fields, decide)",
    MISSING_DATA: "~1-2 min/case (confirm no usable source info exists, mark reviewed or leave open)",
    NON_BLOCKING_ENRICHMENT: "0 -- does not block publication, optional backlog",
  };
  const blocksPublication: Record<Bucket, string> = {
    QUICK_APPROVAL: "No -- already PUBLISHED_WITH_LIMITED_DATA; approval upgrades it to PUBLISHED",
    MEANINGFUL_REVIEW: "Yes -- case is PENDING_REVIEW until resolved",
    MISSING_DATA: "Yes -- case is PENDING_REVIEW (or WITHHELD) until resolved",
    NON_BLOCKING_ENRICHMENT: "No -- was never a publication blocker",
  };
  for (const bucket of Object.keys(caseFilingByBucket) as Bucket[]) {
    const list = caseFilingByBucket[bucket];
    console.log(`${bucket}: ${list.length} cases`);
    console.log(`  Expected effort: ${effort[bucket]}`);
    console.log(`  Blocks publication: ${blocksPublication[bucket]}`);
    console.log(`  Estimated total effort: ${list.length} cases`);
  }
  console.log();

  console.log(`=== Case lists by bucket ===`);
  console.log(JSON.stringify(caseFilingByBucket, null, 2));

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Backlog triage failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
