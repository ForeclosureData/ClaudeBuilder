/**
 * Read-only recalculation of investor-visible inventory under the new
 * publication-readiness model (Phase 5 of the productization pass). Scope
 * is the 282 automated-ingestion cases (countyFilingNumber IS NOT NULL) --
 * the legacy 82 are excluded per the user's "across the 282 current source
 * notices" framing; pass INCLUDE_LEGACY=true to include them too. Zero
 * database writes, zero Anthropic calls.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, type PublicationStatus } from "@foreclosuredata/foreclosure-core";
import { PUBLICATION_EXTRA_INCLUDE, toPublicationInput } from "../lib/publicationVisibility";

const INCLUDE_LEGACY = process.env.INCLUDE_LEGACY === "true";

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  console.log(`=== Publication-status recalculation (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)`);
  console.log(`Scope: ${INCLUDE_LEGACY ? "all non-archived cases (282 ingested + 82 legacy)" : "the 282 automated-ingestion cases only (countyFilingNumber IS NOT NULL)"}\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: INCLUDE_LEGACY ? {} : { countyFilingNumber: { not: null } },
    include: {
      borrower: { select: { fullName: true } },
      property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
      sales: { select: { saleDate: true } },
      ...PUBLICATION_EXTRA_INCLUDE,
    },
  });

  console.log(`Total cases in scope: ${cases.length}\n`);

  const counts: Record<PublicationStatus, number> = { PUBLISHED: 0, PUBLISHED_WITH_LIMITED_DATA: 0, PENDING_REVIEW: 0, WITHHELD: 0, ARCHIVED: 0 };
  let addressPendingCount = 0;
  const blockerCounts: Record<string, number> = {};
  const filingsByStatus: Record<PublicationStatus, string[]> = { PUBLISHED: [], PUBLISHED_WITH_LIMITED_DATA: [], PENDING_REVIEW: [], WITHHELD: [], ARCHIVED: [] };

  for (const c of cases) {
    const result = computePublicationStatus(toPublicationInput(c));
    counts[result.status]++;
    if (result.addressPending) addressPendingCount++;
    for (const b of result.blockingReasons) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
    filingsByStatus[result.status].push(c.caseNumber ?? c.id);
  }

  console.log(`=== Publication status breakdown ===`);
  console.log(`PUBLISHED (immediately publishable): ${counts.PUBLISHED} (${pct(counts.PUBLISHED, cases.length)})`);
  console.log(`PUBLISHED_WITH_LIMITED_DATA (publishable with limited enrichment): ${counts.PUBLISHED_WITH_LIMITED_DATA} (${pct(counts.PUBLISHED_WITH_LIMITED_DATA, cases.length)})`);
  console.log(`  -- of which address-pending: ${addressPendingCount}`);
  console.log(`PENDING_REVIEW (pending critical review): ${counts.PENDING_REVIEW} (${pct(counts.PENDING_REVIEW, cases.length)})`);
  console.log(`WITHHELD (missing/invalid source notice): ${counts.WITHHELD} (${pct(counts.WITHHELD, cases.length)})`);
  console.log(`ARCHIVED: ${counts.ARCHIVED} (${pct(counts.ARCHIVED, cases.length)})`);
  console.log();

  const totalPubliclyVisible = counts.PUBLISHED + counts.PUBLISHED_WITH_LIMITED_DATA;
  console.log(`Total publicly visible (PUBLISHED + PUBLISHED_WITH_LIMITED_DATA): ${totalPubliclyVisible} (${pct(totalPubliclyVisible, cases.length)})`);
  console.log();

  console.log(`=== Most common blockers/gaps (across all cases, not just PENDING_REVIEW) ===`);
  const sortedBlockers = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedBlockers) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log();

  console.log(`=== Filing numbers by status ===`);
  console.log(JSON.stringify(filingsByStatus, null, 2));

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Publication-status report failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
