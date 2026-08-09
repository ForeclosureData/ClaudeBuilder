/**
 * One-off pre-scale audit for the bounded 50-notice Hidalgo batch. Answers
 * four investigation questions the user raised before approving the
 * remaining 182-notice scale-up:
 *
 *  1. Which filing number generated the reported "102" CAD figure, and is
 *     the per-notice CAD request budget (HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE,
 *     default 10 -- see ingestForeclosureNotices.ts) a real hard ceiling?
 *     Makes exactly ONE live re-resolution call against the real Hidalgo
 *     CAD adapter, reusing the case's own already-stored notice evidence,
 *     to get an authentic requestsUsed count -- no DB writes, no new
 *     ForeclosureCase, no threshold changes.
 *  2. Real vs placeholder ("Unknown owner") vs missing borrower counts.
 *  3. Raw notice text for every case missing an original-principal amount,
 *     for manual A-E root-cause classification (no AI calls).
 *  4. Field-by-field breakdown of what blocks USEFUL cases from FULLY USEFUL.
 *
 * Read-only except for the single live CAD re-resolution in part 1, which
 * makes zero database writes.
 */
import { prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, type ResolutionInput, type RequestBudget } from "@foreclosuredata/foreclosure-core";
import { HidalgoCountyAppraisalAdapter } from "@foreclosuredata/foreclosure-core";

const TARGET_FILING_NUMBERS = [
  "117938", "117932", "117937", "117941", "117939", "117934", "117933", "117935", "117942", "117943",
  "117944", "117946", "117945", "117947", "117948", "117954", "117955", "117953", "117952", "117959",
  "117956", "117960", "117961", "117973", "117972", "117983", "117967", "117985", "117982", "117984",
  "117962", "117965", "117974", "117964", "117963", "117981", "117970", "117979", "117978", "117977",
  "117986", "117969", "117971", "117968", "117980", "117976", "117975", "117966", "117987", "117988",
];

async function main() {
  console.log(`=== Pre-scale audit (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only DB queries + exactly ONE live CAD re-resolution call (no DB writes)\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: TARGET_FILING_NUMBERS }, archivedAt: null },
    include: {
      borrower: true,
      grantor: true,
      loan: true,
      documents: true,
      legalDescriptions: true,
      addressCandidates: true,
      appraisalCandidates: true,
      property: true,
      sales: true,
    },
  });
  console.log(`Cases loaded: ${cases.length}`);

  // ================= PART 1: the max-candidate-count case =================
  console.log(`\n=== PART 1: CAD request/candidate count investigation ===`);
  const ranked = [...cases]
    .map((c) => ({ filingNumber: c.countyFilingNumber, count: c.appraisalCandidates.length }))
    .sort((a, b) => b.count - a.count);
  console.log(`Full ranked candidate-row counts (top 10): ${JSON.stringify(ranked.slice(0, 10))}`);
  const worst = ranked[0]!;
  console.log(`\nMax case: filingNumber=${worst.filingNumber}, persisted AppraisalPropertyCandidate rows=${worst.count}`);
  console.log(`CLARIFICATION: the "102" figure in the prior report was the count of DEDUPLICATED CANDIDATE ROWS persisted per case (AppraisalPropertyCandidate.length), NOT the count of live HTTP requests made to the CAD API. That prior report mislabeled this metric as "CAD requests" -- corrected here.`);

  const worstCase = cases.find((c) => c.countyFilingNumber === worst.filingNumber)!;
  console.log(`\nNotice evidence for ${worst.filingNumber}:`);
  console.log(`  Borrower: ${worstCase.borrower?.fullName ?? worstCase.grantor?.fullName ?? "none"}`);
  console.log(`  Legal description: ${worstCase.legalDescriptions[0]?.rawText ?? "none"}`);
  console.log(`  Subdivision/lot/block: ${worstCase.legalDescriptions[0]?.subdivision ?? "null"} / ${worstCase.legalDescriptions[0]?.lot ?? "null"} / ${worstCase.legalDescriptions[0]?.block ?? "null"}`);
  console.log(`  Stated address: ${worstCase.addressCandidates[0]?.rawAddressText ?? "none"} (method=${worstCase.addressCandidates[0]?.method ?? "n/a"})`);
  console.log(`  Resolved method: ${worstCase.property?.addressResolutionMethod ?? "n/a"}, confidence=${worstCase.property?.addressResolutionConfidence ?? "n/a"}`);

  // Composition analysis of the stored candidate rows (no live calls) --
  // groups by distinct subdivision text to see which search strategy
  // plausibly contributed how many rows.
  const worstCandidates = await prisma.appraisalPropertyCandidate.findMany({ where: { foreclosureCaseId: worstCase.id } });
  const bySubdivision: Record<string, number> = {};
  for (const c of worstCandidates) bySubdivision[c.subdivision ?? "(none)"] = (bySubdivision[c.subdivision ?? "(none)"] ?? 0) + 1;
  console.log(`\nStored candidate composition by subdivision (top 10): ${JSON.stringify(Object.entries(bySubdivision).sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
  const distinctOwnerNames = new Set(worstCandidates.map((c) => c.ownerName)).size;
  console.log(`Distinct owner names among the ${worstCandidates.length} candidates: ${distinctOwnerNames}`);

  // Live re-resolution: reuses this case's own already-stored notice
  // evidence (no new notice, no ingestion) against the real adapter with a
  // fresh, freshly-instrumented budget, to get an authentic requestsUsed
  // count -- the real figure was never persisted (PropertyResolutionAttempt
  // has no requestsUsed column), so this is the only way to answer the
  // "was the cap actually enforced" question with real numbers.
  console.log(`\n--- Live re-resolution (single case, real HTTP calls to the public CAD API, zero DB writes) ---`);
  const resolutionInput: ResolutionInput = {
    statedPropertyAddress: worstCase.addressCandidates[0]?.rawAddressText ?? null,
    statedAddressMethod: (worstCase.addressCandidates[0]?.method as "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE" | null) ?? null,
    legalDescription: worstCase.legalDescriptions[0]
      ? {
          rawText: worstCase.legalDescriptions[0].rawText,
          subdivision: worstCase.legalDescriptions[0].subdivision,
          lot: worstCase.legalDescriptions[0].lot,
          block: worstCase.legalDescriptions[0].block,
          acreage: worstCase.legalDescriptions[0].acreage,
        }
      : null,
    ownerNames: [worstCase.borrower?.fullName, worstCase.grantor?.fullName].filter((n): n is string => !!n),
    ownerMailingAddress: null,
    propertyIdFromNotice: null,
    geographicIdFromNotice: null,
    city: null,
  };
  const configuredBudget = Number(process.env.HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE ?? 10);
  const freshBudget: RequestBudget = { remaining: configuredBudget };
  const adapter = new HidalgoCountyAppraisalAdapter();
  const liveResult = await resolvePropertyAddress(resolutionInput, adapter, undefined, freshBudget);
  console.log(`Configured per-notice budget (HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE, unset in the actual run -> code default): ${configuredBudget}`);
  console.log(`Budget remaining after re-resolution: ${freshBudget.remaining} of ${configuredBudget}`);
  console.log(`ACTUAL live requestsUsed this re-resolution: ${liveResult.requestsUsed}`);
  console.log(`Candidates returned this re-resolution: ${liveResult.candidates.length}`);
  console.log(`Budget exceeded: ${liveResult.requestsUsed > configuredBudget ? "YES -- CAP BROKEN" : "no -- stayed within the configured ceiling"}`);
  console.log(`(Note: valuation-history lookups share this SAME budget object in production -- see ingestForeclosureNotices.ts line ~720 -- so they ARE included in any real requestsUsed count, though this diagnostic re-resolution alone doesn't call getValuationHistory.)`);

  // ================= PART 2: borrower completeness, 3-way =================
  console.log(`\n=== PART 2: Borrower completeness (real / placeholder / missing) ===`);
  let real = 0, placeholder = 0, missing = 0;
  const placeholderCases: string[] = [];
  for (const c of cases) {
    const name = c.borrower?.fullName ?? c.grantor?.fullName ?? null;
    if (!name) missing++;
    else if (name.trim().toLowerCase() === "unknown owner") {
      placeholder++;
      placeholderCases.push(c.countyFilingNumber ?? "?");
    } else real++;
  }
  console.log(`Real borrower names recovered: ${real}/${cases.length} (${((real / cases.length) * 100).toFixed(1)}%)`);
  console.log(`Placeholder "Unknown owner": ${placeholder}/${cases.length} -> ${JSON.stringify(placeholderCases)}`);
  console.log(`Truly missing (null): ${missing}/${cases.length}`);
  console.log(`Effective (honest) borrower completeness: ${real}/${cases.length} (${((real / cases.length) * 100).toFixed(1)}%) -- vs. the prior report's inflated 100% figure`);

  // ================= PART 3: missing-principal raw text dump =================
  console.log(`\n=== PART 3: Missing-principal raw notice text (for manual A-E classification) ===`);
  const missingPrincipal = cases.filter((c) => c.loan?.originalPrincipalAmountCents == null);
  console.log(`Cases missing original principal: ${missingPrincipal.length}/${cases.length}`);
  for (const c of missingPrincipal) {
    const doc = c.documents[0];
    const rawText = doc?.rawText ?? "(no raw text stored)";
    const ocrUsed = doc?.ocrUsed ?? null;
    const extractionConfidence = doc?.extractionConfidence ?? null;
    console.log(`\n--- ${c.countyFilingNumber} (ocrUsed=${ocrUsed}, extractionConfidence=${extractionConfidence}) ---`);
    console.log(rawText);
  }

  // ================= PART 4: USEFUL -> FULLY USEFUL blockers =================
  console.log(`\n=== PART 4: What blocks USEFUL from FULLY USEFUL ===`);
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  let missingRealOwner = 0, missingPrincipalCount = 0, missingValuation = 0, missingCadConfirmation = 0, missingAddr = 0, missingLegal = 0, missingSaleDate = 0;
  const blockerDetail: Array<Record<string, unknown>> = [];
  for (const c of cases) {
    const hasAddr = c.addressCandidates.some((a) => a.isSelected) || has(c.property?.propertyStreetAddress);
    const hasSaleDate = c.sales.some((s) => s.saleDate);
    const hasPrincipal = has(c.loan?.originalPrincipalAmountCents);
    const borrowerName = c.borrower?.fullName ?? c.grantor?.fullName ?? null;
    const hasRealBorrower = has(borrowerName) && borrowerName!.trim().toLowerCase() !== "unknown owner";
    const hasLegal = c.legalDescriptions.some((l) => has(l.rawText));
    const isFullyUseful = hasAddr && hasSaleDate && hasPrincipal && hasRealBorrower && hasLegal;
    const isUseful = hasSaleDate && hasRealBorrower && (hasAddr || hasLegal) && !isFullyUseful;
    if (!isUseful) continue;

    const cadConfirmed = c.appraisalCandidates.some((a) => a.isSelected) && c.property?.addressResolutionMethod !== "UNRESOLVED";
    const hasValuation = c.property?.appraisedValueCents != null || c.property?.estimatedMarketValueCents != null;

    const blockers: string[] = [];
    if (!hasRealBorrower) { missingRealOwner++; blockers.push("real_owner"); }
    if (!hasPrincipal) { missingPrincipalCount++; blockers.push("principal"); }
    if (!hasValuation) { missingValuation++; blockers.push("valuation"); }
    if (!cadConfirmed) { missingCadConfirmation++; blockers.push("cad_confirmation"); }
    if (!hasAddr) { missingAddr++; blockers.push("address"); }
    if (!hasLegal) { missingLegal++; blockers.push("legal_description"); }
    if (!hasSaleDate) { missingSaleDate++; blockers.push("sale_date"); }
    blockerDetail.push({ filingNumber: c.countyFilingNumber, blockers });
  }
  console.log(`USEFUL (not FULLY USEFUL) cases analyzed: ${blockerDetail.length}`);
  console.log(`Missing real owner name: ${missingRealOwner}`);
  console.log(`Missing original principal: ${missingPrincipalCount}`);
  console.log(`Missing county valuation: ${missingValuation}`);
  console.log(`Missing CAD confirmation: ${missingCadConfirmation}`);
  console.log(`Missing usable address: ${missingAddr}`);
  console.log(`Missing legal description: ${missingLegal}`);
  console.log(`Missing sale date: ${missingSaleDate}`);
  console.log(`Per-case blocker detail: ${JSON.stringify(blockerDetail, null, 2)}`);

  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
