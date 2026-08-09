/**
 * Reusable, read-only post-ingestion batch report. Takes the batch's
 * filing numbers via TARGET_FILING_NUMBERS (comma-separated) so it can be
 * reused across every bounded Hidalgo batch, plus the final full-bundle
 * reconciliation (pass every filing number ingested so far, or omit the
 * env var to report on the whole current non-archived ForeclosureCase
 * table). Zero database writes, zero Anthropic calls.
 *
 * Prints: production-integrity check (total count, duplicate-filing-number
 * scan), extraction completeness (with honest borrower real/placeholder/
 * missing split), investor usefulness classification, property-resolution
 * stats plus full CAD parcel detail for every auto-attached candidate
 * (manual safety review), valuation availability, duplicate-event
 * detection results, and manual-review reason breakdown.
 */
import { prisma } from "@foreclosuredata/database";

const raw = process.env.TARGET_FILING_NUMBERS;
const TARGET_FILING_NUMBERS = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  console.log(`=== Batch report (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)`);
  console.log(`Scope: ${TARGET_FILING_NUMBERS ? `${TARGET_FILING_NUMBERS.length} filing numbers passed via TARGET_FILING_NUMBERS` : "ALL non-archived ForeclosureCase rows"}\n`);

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

  const where = TARGET_FILING_NUMBERS
    ? { countyFilingNumber: { in: TARGET_FILING_NUMBERS }, archivedAt: null }
    : { archivedAt: null };

  const cases = await prisma.foreclosureCase.findMany({
    where,
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
      duplicateLinksAsCaseA: { include: { caseA: { select: { countyFilingNumber: true } }, caseB: { select: { countyFilingNumber: true } } } },
      duplicateLinksAsCaseB: { include: { caseA: { select: { countyFilingNumber: true } }, caseB: { select: { countyFilingNumber: true } } } },
    },
  });

  console.log(`\nCases found in DB for this scope: ${cases.length}${TARGET_FILING_NUMBERS ? ` of ${TARGET_FILING_NUMBERS.length} expected` : ""}`);
  if (TARGET_FILING_NUMBERS) {
    const missing = TARGET_FILING_NUMBERS.filter((fn) => !cases.some((c) => c.countyFilingNumber === fn));
    if (missing.length) console.log(`MISSING from DB (unexpected): ${JSON.stringify(missing)}`);
  }

  // ---- EXTRACTION completeness (honest borrower split) ----
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  let realBorrower = 0, placeholderBorrower = 0, missingBorrower = 0;
  const placeholderCases: string[] = [];
  for (const c of cases) {
    const name = c.borrower?.fullName ?? c.grantor?.fullName ?? null;
    if (!name) missingBorrower++;
    else if (name.trim().toLowerCase() === "unknown owner") {
      placeholderBorrower++;
      placeholderCases.push(c.countyFilingNumber ?? "?");
    } else realBorrower++;
  }
  const principalOk = cases.filter((c) => has(c.loan?.originalPrincipalAmountCents)).length;
  const saleDateOk = cases.filter((c) => c.sales.some((s) => s.saleDate)).length;
  const legalDescOk = cases.filter((c) => c.legalDescriptions.some((l) => has(l.rawText))).length;
  const usableAddressOk = cases.filter((c) => c.addressCandidates.some((a) => a.isSelected) || has(c.property?.propertyStreetAddress)).length;
  const lenderOk = cases.filter((c) => has(c.loan?.originalLender?.name) || has(c.loan?.currentMortgagee?.name)).length;
  const servicerOk = cases.filter((c) => has(c.loan?.mortgageServicer?.name)).length;

  console.log(`\n=== EXTRACTION completeness (of ${cases.length}) ===`);
  console.log(`Real borrower names: ${realBorrower}/${cases.length} (${pct(realBorrower, cases.length)})`);
  console.log(`Placeholder "Unknown owner": ${placeholderBorrower}/${cases.length} -> ${JSON.stringify(placeholderCases)}`);
  console.log(`Truly missing borrower: ${missingBorrower}/${cases.length}`);
  console.log(`Principal completeness: ${principalOk}/${cases.length} (${pct(principalOk, cases.length)})`);
  console.log(`Sale-date completeness: ${saleDateOk}/${cases.length} (${pct(saleDateOk, cases.length)})`);
  console.log(`Legal-description completeness: ${legalDescOk}/${cases.length} (${pct(legalDescOk, cases.length)})`);
  console.log(`Usable-address rate: ${usableAddressOk}/${cases.length} (${pct(usableAddressOk, cases.length)})`);
  console.log(`Lender completeness: ${lenderOk}/${cases.length} (${pct(lenderOk, cases.length)})`);
  console.log(`Servicer completeness: ${servicerOk}/${cases.length} (${pct(servicerOk, cases.length)})`);

  // ---- INVESTOR USEFULNESS ----
  let fullyUseful = 0, useful = 0, limited = 0;
  for (const c of cases) {
    const hasAddr = c.addressCandidates.some((a) => a.isSelected) || has(c.property?.propertyStreetAddress);
    const hasSaleDate = c.sales.some((s) => s.saleDate);
    const hasPrincipal = has(c.loan?.originalPrincipalAmountCents);
    const borrowerName = c.borrower?.fullName ?? c.grantor?.fullName ?? null;
    const hasRealBorrower = has(borrowerName) && borrowerName!.trim().toLowerCase() !== "unknown owner";
    const hasLegal = c.legalDescriptions.some((l) => has(l.rawText));
    if (hasAddr && hasSaleDate && hasPrincipal && hasRealBorrower && hasLegal) fullyUseful++;
    else if (hasSaleDate && hasRealBorrower && (hasAddr || hasLegal)) useful++;
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

    if (selected && c.property?.addressResolutionMethod && c.property.addressResolutionMethod !== "UNRESOLVED") cadConfirmed++;
    else if (candidateCount > 0 && !selected) strongAwaitingApproval++;
    else if (candidateCount === 0) noMatch++;

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
  console.log(`Total CAD candidate rows returned (NOTE: this is deduplicated candidate rows, not live HTTP requests -- see the pre-scale audit's finding on this metric): ${totalCadRequests}`);
  console.log(`Average per case: ${avgRequests.toFixed(2)}`);
  console.log(`Max per case: ${maxRequests}`);

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
  for (const c of cases) if (c.duplicateLinksAsCaseA.length || c.duplicateLinksAsCaseB.length) casesInvolvedInLinks.add(c.id);

  console.log(`\n=== DUPLICATE-EVENT DETECTION (of ${cases.length}) ===`);
  console.log(`Possible duplicate-event pairs (any tier): ${uniqueLinkIds.size}`);
  console.log(`Confirmed same-event pairs: ${confirmedSameEvent}`);
  console.log(`Likely same-event pairs: ${likelySameEvent}`);
  console.log(`Possible (weaker signal) pairs: ${possibleDuplicate}`);
  console.log(`Distinct-event cases correctly kept separate (not merged/archived): ${cases.length - casesInvolvedInLinks.size} untouched, ${casesInvolvedInLinks.size} flagged for review`);
  if (uniqueLinkIds.size > 0) {
    const linkDetail = [...new Map(allLinks.map((l) => [l.id, l])).values()].map((l) => ({
      confidence: l.confidence,
      status: l.status,
      matchedFields: l.matchedFields,
      conflictingFields: l.conflictingFields,
      caseA: l.caseA?.countyFilingNumber ?? l.caseAId,
      caseB: l.caseB?.countyFilingNumber ?? l.caseBId,
    }));
    console.log(`Link detail: ${JSON.stringify(linkDetail, null, 2)}`);
  }

  // ---- Manual review reasons breakdown ----
  const reasonCounts: Record<string, number> = {};
  for (const c of cases) for (const t of c.manualReviewTasks) reasonCounts[t.reason] = (reasonCounts[t.reason] ?? 0) + 1;
  console.log(`\n=== Manual review reason breakdown (${cases.filter((c) => c.manualReviewTasks.length > 0).length} cases with >=1 task) ===`);
  console.log(JSON.stringify(reasonCounts, null, 2));

  // ---- Borrower/principal dump for structural spot-check ----
  console.log(`\n=== Borrower/principal values for manual structural review (all ${cases.length} cases) ===`);
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
