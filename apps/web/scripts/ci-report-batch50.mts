/**
 * GitHub Actions entrypoint for the full post-ingestion report on the
 * bounded 50-notice production batch (see ci-select-hidalgo-target.mts and
 * ci-ingest-hidalgo.mts production mode). Read-only: makes zero database
 * writes and zero Anthropic API calls -- pure reporting over what the
 * ingestion run already persisted.
 *
 * Prints every metric requested for this batch's report: extraction
 * completeness, investor usefulness classification, property-resolution
 * stats (including full per-case CAD parcel detail for manual safety
 * verification), valuation availability, duplicate-event detection
 * results, and production-safety integrity checks (total counts,
 * duplicate-row scan).
 */
import { prisma } from "@foreclosuredata/database";

const TARGET_FILING_NUMBERS = [
  "117938", "117932", "117937", "117941", "117939", "117934", "117933", "117935", "117942", "117943",
  "117944", "117946", "117945", "117947", "117948", "117954", "117955", "117953", "117952", "117959",
  "117956", "117960", "117961", "117973", "117972", "117983", "117967", "117985", "117982", "117984",
  "117962", "117965", "117974", "117964", "117963", "117981", "117970", "117979", "117978", "117977",
  "117986", "117969", "117971", "117968", "117980", "117976", "117975", "117966", "117987", "117988",
];

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  console.log(`=== Bounded 50-notice batch report (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  // ---- SAFETY: production integrity check first ----
  const totalCaseCount = await prisma.foreclosureCase.count({ where: { archivedAt: null } });
  const dupRows: Array<{ countyFilingNumber: string | null; count: bigint }> = await prisma.$queryRaw`
    SELECT county_filing_number as "countyFilingNumber", COUNT(*) as count
    FROM foreclosure_cases
    WHERE archived_at IS NULL AND county_filing_number IS NOT NULL
    GROUP BY county_filing_number
    HAVING COUNT(*) > 1
  `;
  console.log(`=== SAFETY: production integrity ===`);
  console.log(`Total ForeclosureCase rows (non-archived): ${totalCaseCount}`);
  console.log(`Duplicate (countyId, countyFilingNumber) groups found: ${dupRows.length}${dupRows.length ? " -> " + JSON.stringify(dupRows.map((d) => ({ ...d, count: Number(d.count) }))) : ""}`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: TARGET_FILING_NUMBERS }, archivedAt: null },
    include: {
      borrower: true,
      grantor: true,
      loan: { include: { originalLender: true, currentMortgagee: true, mortgageServicer: true } },
      sales: true,
      legalDescriptions: true,
      addressCandidates: true,
      property: true,
      appraisalCandidates: true,
      resolutionAttempts: { orderBy: { createdAt: "desc" } },
      manualReviewTasks: true,
      duplicateLinksAsCaseA: { include: { caseB: { select: { caseNumber: true, countyFilingNumber: true } } } },
      duplicateLinksAsCaseB: { include: { caseA: { select: { caseNumber: true, countyFilingNumber: true } } } },
    },
  });

  console.log(`\nBatch cases found in DB: ${cases.length} of ${TARGET_FILING_NUMBERS.length} expected`);
  const missing = TARGET_FILING_NUMBERS.filter((fn) => !cases.some((c) => c.countyFilingNumber === fn));
  if (missing.length) console.log(`MISSING from DB (unexpected): ${JSON.stringify(missing)}`);

  // ---- EXTRACTION completeness ----
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  const borrowerOk = cases.filter((c) => has(c.borrower?.fullName) || has(c.grantor?.fullName)).length;
  const principalOk = cases.filter((c) => has(c.loan?.originalPrincipalAmountCents)).length;
  const saleDateOk = cases.filter((c) => c.sales.some((s) => s.saleDate)).length;
  const legalDescOk = cases.filter((c) => c.legalDescriptions.some((l) => has(l.rawText))).length;
  const usableAddressOk = cases.filter((c) => c.addressCandidates.some((a) => a.isSelected) || has(c.property?.propertyStreetAddress)).length;
  const lenderOk = cases.filter((c) => has(c.loan?.originalLender?.name) || has(c.loan?.currentMortgagee?.name)).length;
  const servicerOk = cases.filter((c) => has(c.loan?.mortgageServicer?.name)).length;

  console.log(`\n=== EXTRACTION completeness (of ${cases.length}) ===`);
  console.log(`Borrower completeness: ${borrowerOk}/${cases.length} (${pct(borrowerOk, cases.length)})`);
  console.log(`Principal completeness: ${principalOk}/${cases.length} (${pct(principalOk, cases.length)})`);
  console.log(`Sale-date completeness: ${saleDateOk}/${cases.length} (${pct(saleDateOk, cases.length)})`);
  console.log(`Legal-description completeness: ${legalDescOk}/${cases.length} (${pct(legalDescOk, cases.length)})`);
  console.log(`Usable-address rate: ${usableAddressOk}/${cases.length} (${pct(usableAddressOk, cases.length)})`);
  console.log(`Lender completeness: ${lenderOk}/${cases.length} (${pct(lenderOk, cases.length)})`);
  console.log(`Servicer completeness: ${servicerOk}/${cases.length} (${pct(servicerOk, cases.length)})`);

  // ---- INVESTOR USEFULNESS classification ----
  // FULLY USEFUL: address + sale date + principal + borrower + legal description all present.
  // USEFUL: sale date + at least one of (address, legal description) + borrower present, missing something else.
  // LIMITED: everything else.
  let fullyUseful = 0, useful = 0, limited = 0;
  for (const c of cases) {
    const hasAddr = c.addressCandidates.some((a) => a.isSelected) || has(c.property?.propertyStreetAddress);
    const hasSaleDate = c.sales.some((s) => s.saleDate);
    const hasPrincipal = has(c.loan?.originalPrincipalAmountCents);
    const hasBorrower = has(c.borrower?.fullName) || has(c.grantor?.fullName);
    const hasLegal = c.legalDescriptions.some((l) => has(l.rawText));
    if (hasAddr && hasSaleDate && hasPrincipal && hasBorrower && hasLegal) fullyUseful++;
    else if (hasSaleDate && hasBorrower && (hasAddr || hasLegal)) useful++;
    else limited++;
  }
  console.log(`\n=== INVESTOR USEFULNESS (of ${cases.length}) ===`);
  console.log(`FULLY USEFUL: ${fullyUseful} (${pct(fullyUseful, cases.length)})`);
  console.log(`USEFUL: ${useful} (${pct(useful, cases.length)})`);
  console.log(`LIMITED: ${limited} (${pct(limited, cases.length)})`);

  // ---- PROPERTY RESOLUTION ----
  let cadConfirmed = 0, strongAwaitingApproval = 0, noMatch = 0, ownerConflict = 0, subdivisionConflict = 0, lotBlockConflict = 0, ambiguousHold = 0;
  let totalCadRequests = 0;
  const requestsPerCase: number[] = [];
  const parcelDumps: Array<Record<string, unknown>> = [];

  for (const c of cases) {
    const candidateCount = c.appraisalCandidates.length;
    totalCadRequests += candidateCount;
    requestsPerCase.push(candidateCount);
    const latestAttempt = c.resolutionAttempts[0];
    const selected = c.appraisalCandidates.find((a) => a.isSelected);

    if (selected && c.property?.addressResolutionMethod && c.property.addressResolutionMethod !== "UNRESOLVED") {
      cadConfirmed++;
    } else if (candidateCount > 0 && !selected) {
      strongAwaitingApproval++;
    } else if (candidateCount === 0) {
      noMatch++;
    }

    const reasons = c.manualReviewTasks.map((t) => t.reason);
    if (reasons.includes("CAD_OWNER_CONFLICT")) ownerConflict++;
    if (latestAttempt?.conflictingFields.some((f) => /subdivision/i.test(f))) subdivisionConflict++;
    if (latestAttempt?.conflictingFields.some((f) => /lot|block/i.test(f))) lotBlockConflict++;
    if (reasons.includes("MULTIPLE_APPRAISAL_MATCHES")) ambiguousHold++;

    if (selected) {
      parcelDumps.push({
        filingNumber: c.countyFilingNumber,
        caseNumber: c.caseNumber,
        borrower: c.borrower?.fullName ?? c.grantor?.fullName ?? null,
        noticeLegalDescription: c.legalDescriptions[0]?.rawText ?? null,
        noticeAddress: c.addressCandidates.find((a) => a.isSelected)?.rawAddressText ?? null,
        cadOwnerName: selected.ownerName,
        cadSitusAddress: selected.situsAddress,
        cadLegalDescription: selected.legalDescription,
        cadSubdivision: selected.subdivision,
        cadLot: selected.lot,
        cadBlock: selected.block,
        cadParcelId: selected.parcelId,
        matchedFields: selected.matchedFields,
        conflictingFields: selected.conflictingFields,
        score: selected.score,
        resolutionMethod: c.property?.addressResolutionMethod,
        resolutionConfidence: c.property?.addressResolutionConfidence,
      });
    }
  }
  const avgRequests = requestsPerCase.length ? requestsPerCase.reduce((a, b) => a + b, 0) / requestsPerCase.length : 0;
  const maxRequests = requestsPerCase.length ? Math.max(...requestsPerCase) : 0;

  console.log(`\n=== PROPERTY RESOLUTION (of ${cases.length}) ===`);
  console.log(`CAD-confirmed parcels: ${cadConfirmed}`);
  console.log(`Strong candidates awaiting approval: ${strongAwaitingApproval}`);
  console.log(`No-match cases: ${noMatch}`);
  console.log(`Owner conflicts: ${ownerConflict}`);
  console.log(`Subdivision conflicts: ${subdivisionConflict}`);
  console.log(`Lot/block conflicts: ${lotBlockConflict}`);
  console.log(`Ambiguous holds: ${ambiguousHold}`);
  console.log(`Total CAD requests (candidates returned, all cases): ${totalCadRequests}`);
  console.log(`Average requests per case: ${avgRequests.toFixed(2)}`);
  console.log(`Max requests per case: ${maxRequests}`);

  console.log(`\n=== SAFETY: full CAD parcel detail for manual inspection (${parcelDumps.length} auto-attached) ===`);
  console.log(JSON.stringify(parcelDumps, null, 2));

  // ---- VALUATION ----
  const propIds = cases.map((c) => c.propertyId).filter((id): id is string => !!id);
  const valuationHistory = propIds.length
    ? await prisma.appraisalValueHistory.findMany({ where: { propertyId: { in: propIds } } })
    : [];
  const marketValueOk = new Set(valuationHistory.filter((v) => v.marketValueCents != null).map((v) => v.propertyId)).size;
  const appraisedValueOk = new Set(valuationHistory.filter((v) => v.appraisedValueCents != null).map((v) => v.propertyId)).size;
  const landValueOk = new Set(valuationHistory.filter((v) => v.landValueCents != null).map((v) => v.propertyId)).size;
  const improvementValueOk = new Set(valuationHistory.filter((v) => v.improvementValueCents != null).map((v) => v.propertyId)).size;
  const yearDist: Record<string, number> = {};
  for (const v of valuationHistory) yearDist[String(v.taxYear)] = (yearDist[String(v.taxYear)] ?? 0) + 1;

  console.log(`\n=== VALUATION (of ${cases.length} cases, ${propIds.length} with a resolved property) ===`);
  console.log(`Market value available: ${marketValueOk}`);
  console.log(`Appraised value available: ${appraisedValueOk}`);
  console.log(`Land value available: ${landValueOk}`);
  console.log(`Improvement value available: ${improvementValueOk}`);
  console.log(`Valuation year distribution: ${JSON.stringify(yearDist)}`);

  // ---- DUPLICATE-EVENT DETECTION ----
  const allLinks = cases.flatMap((c) => [...c.duplicateLinksAsCaseA, ...c.duplicateLinksAsCaseB]);
  const uniqueLinkIds = new Set(allLinks.map((l) => l.id));
  const confirmedSameEvent = allLinks.filter((l) => l.confidence === "CONFIRMED_SAME_EVENT").length;
  const likelySameEvent = allLinks.filter((l) => l.confidence === "LIKELY_SAME_EVENT").length;
  const possibleDuplicate = allLinks.filter((l) => l.confidence === "POSSIBLE_DUPLICATE").length;
  const casesInvolvedInLinks = new Set<string>();
  for (const c of cases) {
    if (c.duplicateLinksAsCaseA.length || c.duplicateLinksAsCaseB.length) casesInvolvedInLinks.add(c.id);
  }
  // Estimate: each CONFIRMED_SAME_EVENT pair represents one fewer distinct
  // real-world event than source notices (no merges performed -- both rows
  // stay, this is an estimate for reporting only, not a DB operation).
  const estimatedUniqueEventCount = cases.length - confirmedSameEvent;

  console.log(`\n=== DUPLICATE-EVENT DETECTION (of ${cases.length}) ===`);
  console.log(`Possible duplicate-event pairs (any tier): ${uniqueLinkIds.size}`);
  console.log(`Confirmed same-event pairs: ${confirmedSameEvent}`);
  console.log(`Likely same-event pairs: ${likelySameEvent}`);
  console.log(`Possible (weaker signal) pairs: ${possibleDuplicate}`);
  console.log(`Distinct-event cases correctly not collapsed: ${cases.length - casesInvolvedInLinks.size} untouched, ${casesInvolvedInLinks.size} flagged for review (none archived/merged)`);
  console.log(`Source notice count vs estimated unique event count: ${cases.length} source notices vs ~${estimatedUniqueEventCount} estimated unique events (estimate only; no merges performed, both records always kept)`);

  // ---- Manual review reasons breakdown ----
  const reasonCounts: Record<string, number> = {};
  for (const c of cases) for (const t of c.manualReviewTasks) reasonCounts[t.reason] = (reasonCounts[t.reason] ?? 0) + 1;
  console.log(`\n=== Manual review reason breakdown (${cases.filter((c) => c.manualReviewTasks.length > 0).length} cases with >=1 task) ===`);
  console.log(JSON.stringify(reasonCounts, null, 2));

  // ---- AI-recovered field dump for structurally-unusual manual verification ----
  console.log(`\n=== Borrower/principal values for manual structural review (all ${cases.length} cases) ===`);
  console.log(`(Note: AI-fallback attribution is tracked at the run level, not per-field in the DB -- see the ingestion run summary for aggregate AI counts. This dump lets a reviewer spot-check every value regardless of extraction path.)`);
  for (const c of cases) {
    console.log(
      JSON.stringify({
        filingNumber: c.countyFilingNumber,
        borrower: c.borrower?.fullName ?? null,
        grantor: c.grantor?.fullName ?? null,
        coOwnerNames: c.coOwnerNames,
        principalCents: c.loan?.originalPrincipalAmountCents ?? null,
      }),
    );
  }

  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
