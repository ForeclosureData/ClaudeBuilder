/**
 * Phase 4 of the Hidalgo beta-readiness pass: recalculates the full
 * investor-facing inventory after the Phase 1 (52-case human review) and
 * Phase 2 (visible-listing address audit) resolution passes, and reruns
 * the address-pollution detector across the now-current visible set as a
 * final safety check. Read-only, zero writes, zero Anthropic calls.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

const ROLE_KEYWORDS: RegExp[] = [
  /substitute trustee'?s?\s+address/i, /trustee'?s?\s+address/i, /trustee:.{0,80}address/is,
  /lender'?s?\s+address/i, /mortgagee'?s?\s+address/i, /beneficiary'?s?\s+address/i, /servicer'?s?\s+address/i,
  /county courthouse/i, /317 n\.?\s*closner/i, /courthouse door/i,
  /attorney at law/i, /law firm/i, /law office/i,
  /return to:/i, /after recording,?\s*return to/i, /return address/i, /prepared by/i,
];

async function main() {
  console.log(`=== Hidalgo beta-readiness report (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  console.log(`=== ForeclosureCase counts (full table) ===`);
  const total = await prisma.foreclosureCase.count();
  const active = await prisma.foreclosureCase.count({ where: { archivedAt: null } });
  const archived = await prisma.foreclosureCase.count({ where: { archivedAt: { not: null } } });
  const duplicateSuppressed = await prisma.foreclosureCase.count({ where: { archivedAt: { not: null }, archivedReason: { contains: "Confirmed same foreclosure event" } } });
  console.log(`Total: ${total} | Active: ${active} | Archived: ${archived} | Of archived, duplicate-suppressed: ${duplicateSuppressed}\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { not: null }, archivedAt: null },
    include: {
      borrower: { select: { fullName: true } },
      property: { select: { propertyStreetAddress: true, addressResolutionMethod: true, addressResolutionConfidence: true, subdivision: true, lot: true } },
      sales: { select: { saleDate: true } },
      documents: { select: { id: true, rawText: true }, take: 1 },
      legalDescriptions: { select: { id: true }, take: 1 },
      manualReviewTasks: { where: { status: "OPEN" }, select: { reason: true } },
      appraisalCandidates: { select: { isSelected: true } },
      loan: { select: { originalPrincipalAmountCents: true } },
      duplicateLinksAsCaseA: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
      duplicateLinksAsCaseB: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
    },
  });

  const statusCounts: Record<string, number> = {};
  const visible: typeof cases = [];
  let stillCriticallyBlockedButVisible = 0;

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
    if (isPubliclyVisibleStatus(result.status)) visible.push(c);
  }

  const PLACEHOLDER_NAMES = new Set(["unknown owner"]);
  const withUsableAddress = visible.filter((c) => c.property?.propertyStreetAddress && c.property.addressResolutionMethod !== "UNRESOLVED").length;
  const withRealBorrower = visible.filter((c) => c.borrower?.fullName && !PLACEHOLDER_NAMES.has(c.borrower.fullName.trim().toLowerCase())).length;
  const withPrincipal = visible.filter((c) => c.loan?.originalPrincipalAmountCents !== null && c.loan?.originalPrincipalAmountCents !== undefined).length;
  const withCadValuation = visible.filter((c) => c.appraisalCandidates.some((a) => a.isSelected)).length;
  const withUnresolvedCriticalConflict = visible.filter((c) => {
    const critical = new Set(["CAD_OWNER_CONFLICT", "BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT", "MISSING_FILING_NUMBER", "POSSIBLE_CONTENT_DUPLICATE", "POOR_TEXT_QUALITY"]);
    return c.manualReviewTasks.some((t) => critical.has(t.reason));
  }).length;

  console.log(`=== Publication status (282 automated-ingestion scope) ===`);
  console.log(JSON.stringify(statusCounts, null, 2));
  const investorVisible = (statusCounts.PUBLISHED ?? 0) + (statusCounts.PUBLISHED_WITH_LIMITED_DATA ?? 0);
  console.log(`Investor-visible listings: ${investorVisible}`);
  console.log(`Unique foreclosure events (active rows minus confirmed-duplicate-suppressed): ${active - duplicateSuppressed}\n`);

  console.log(`=== Visible-listing data-completeness ===`);
  console.log(`With usable (non-UNRESOLVED) address: ${withUsableAddress} / ${visible.length}`);
  console.log(`With real (non-placeholder) borrower name: ${withRealBorrower} / ${visible.length}`);
  console.log(`With original principal recorded: ${withPrincipal} / ${visible.length}`);
  console.log(`With CAD-confirmed valuation candidate: ${withCadValuation} / ${visible.length}`);
  console.log(`With an unresolved critical-conflict task still open: ${withUnresolvedCriticalConflict} / ${visible.length}\n`);

  console.log(`=== Final safety check: address-pollution re-scan of the current visible set ===`);
  const addrMap = new Map<string, typeof visible>();
  for (const c of visible) {
    const a = c.property?.propertyStreetAddress?.trim().toUpperCase();
    if (!a) continue;
    const arr = addrMap.get(a) ?? [];
    arr.push(c);
    addrMap.set(a, arr);
  }
  const suspicious = [...addrMap.entries()].filter(([, arr]) => arr.length > 1);
  let suspiciousNonPropertyCount = 0;
  for (const [addr, group] of suspicious) {
    const flaggedCases: string[] = [];
    for (const c of group) {
      const rawText = c.documents[0]?.rawText ?? "";
      if (ROLE_KEYWORDS.some((re) => re.test(rawText))) flaggedCases.push(c.caseNumber ?? c.id);
    }
    if (flaggedCases.length > 0) {
      suspiciousNonPropertyCount += flaggedCases.length;
      console.log(`SUSPICIOUS: "${addr}" shared by ${group.length} visible cases, ${flaggedCases.length} flagged as role-address context: ${JSON.stringify(flaggedCases)}`);
    } else {
      console.log(`Repeated but no role-address keyword found: "${addr}" (${group.length} cases: ${JSON.stringify(group.map((c) => c.caseNumber))}) -- likely incomplete-address collision, not a role-address bug.`);
    }
  }
  console.log(`Visible listings with a suspicious/non-property address (role-address keyword match): ${suspiciousNonPropertyCount}`);

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Report failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
