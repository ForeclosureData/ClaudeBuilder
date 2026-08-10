/**
 * Phase 1 of the 55-case publication-blocker triage: freezes the exact set
 * of currently non-public (blocks=true) automated-ingestion cases and dumps
 * every field a human reviewer needs to classify each one, without making
 * any mutation. Zero database writes, zero Anthropic calls.
 *
 * Scope: the 282 automated-ingestion cases (countyFilingNumber IS NOT NULL),
 * matching the scope of ci-reconcile-inventory-vs-backlog.mts. Excludes the
 * 82 legacy-seed cases and the 2 archived duplicates entirely.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

async function main() {
  console.log(`=== Freeze: non-public case set (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)`);
  console.log(`Scope: the 282 automated-ingestion cases (countyFilingNumber IS NOT NULL, archivedAt IS NULL)\n`);

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { not: null }, archivedAt: null },
    include: {
      borrower: { select: { fullName: true } },
      grantor: { select: { fullName: true } },
      property: true,
      sales: { select: { saleDate: true, saleStatus: true, saleLocation: true } },
      loan: { include: { currentMortgagee: { select: { name: true } }, originalLender: { select: { name: true } } } },
      legalDescriptions: true,
      documents: { select: { id: true, countyFilingNumber: true, filingDate: true, manualReviewStatus: true, sourceUrl: true, rawText: true } },
      manualReviewTasks: { where: { status: "OPEN" }, select: { id: true, reason: true, notes: true, createdAt: true } },
      appraisalCandidates: { select: { id: true, ownerName: true, situsAddress: true, parcelId: true, geographicId: true, score: true, matchedFields: true, conflictingFields: true, isSelected: true, appraisedValueCents: true, marketValueCents: true, taxYear: true, homestead: true } },
      duplicateLinksAsCaseA: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT", "POSSIBLE_DUPLICATE"] } } },
      duplicateLinksAsCaseB: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT", "POSSIBLE_DUPLICATE"] } } },
    },
  });

  const propertyIds = cases.map((c) => c.propertyId).filter((id): id is string => id !== null);
  const valueHistory = await prisma.appraisalValueHistory.findMany({ where: { propertyId: { in: propertyIds } }, orderBy: { taxYear: "desc" } });
  const valueHistoryByProperty = new Map<string, typeof valueHistory>();
  for (const v of valueHistory) {
    const arr = valueHistoryByProperty.get(v.propertyId) ?? [];
    arr.push(v);
    valueHistoryByProperty.set(v.propertyId, arr);
  }

  const caseById = new Map(cases.map((c) => [c.id, c]));

  function summarizeCase(c: (typeof cases)[number]) {
    const saleDate = c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null;
    return {
      caseNumber: c.caseNumber,
      countyFilingNumber: c.countyFilingNumber,
      borrowerName: c.borrower?.fullName ?? null,
      grantorName: c.grantor?.fullName ?? null,
      propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
      city: c.property?.city ?? null,
      addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
      addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
      subdivision: c.property?.subdivision ?? c.legalDescriptions[0]?.subdivision ?? null,
      lot: c.property?.lot ?? c.legalDescriptions[0]?.lot ?? null,
      block: c.property?.block ?? c.legalDescriptions[0]?.block ?? null,
      legalDescriptionRawText: c.legalDescriptions[0]?.rawText ?? c.property?.legalDescription ?? null,
      saleDateISO: saleDate ? saleDate.toISOString().slice(0, 10) : null,
      originalPrincipalCents: c.loan?.originalPrincipalAmountCents ?? null,
      deedOfTrustDateISO: c.loan?.deedOfTrustDate ? c.loan.deedOfTrustDate.toISOString().slice(0, 10) : null,
      instrumentNumber: c.loan?.instrumentNumber ?? null,
      lenderName: c.loan?.currentMortgagee?.name ?? c.loan?.originalLender?.name ?? null,
    };
  }

  interface Row {
    caseNumber: string;
    countyFilingNumber: string | null;
    publicationStatus: string;
    blockingReasons: string[];
    hasDuplicateLink: boolean;
    isTaskBlockedOnly: boolean;
    detail: Record<string, unknown>;
  }
  const rows: Row[] = [];
  const duplicatePairsSeen = new Set<string>();
  const duplicatePairs: Array<Record<string, unknown>> = [];

  for (const c of cases) {
    const saleDate = c.sales.find((s) => s.saleDate !== null)?.saleDate ?? null;
    const allDupLinks = [...c.duplicateLinksAsCaseA, ...c.duplicateLinksAsCaseB];
    const activeDupLinks = allDupLinks.filter((l) => l.confidence === "CONFIRMED_SAME_EVENT" || l.confidence === "LIKELY_SAME_EVENT");

    const publicationInput: PublicationInput = {
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
      hasActiveDuplicateLink: activeDupLinks.length > 0,
    };
    const result = computePublicationStatus(publicationInput);
    const blocks = !isPubliclyVisibleStatus(result.status);
    if (!blocks) continue;

    const valHist = c.propertyId ? (valueHistoryByProperty.get(c.propertyId) ?? []) : [];
    const topCandidate = [...c.appraisalCandidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;

    for (const link of activeDupLinks) {
      const pairKey = [link.caseAId, link.caseBId].sort().join("|");
      if (duplicatePairsSeen.has(pairKey)) continue;
      duplicatePairsSeen.add(pairKey);
      const caseA = caseById.get(link.caseAId);
      const caseB = caseById.get(link.caseBId);
      duplicatePairs.push({
        confidence: link.confidence,
        score: link.score,
        matchedFields: link.matchedFields,
        conflictingFields: link.conflictingFields,
        explanation: link.explanation,
        caseA: caseA ? summarizeCase(caseA) : { note: "not in current 282 scope (legacy or archived)", id: link.caseAId },
        caseB: caseB ? summarizeCase(caseB) : { note: "not in current 282 scope (legacy or archived)", id: link.caseBId },
      });
    }

    rows.push({
      caseNumber: c.caseNumber ?? c.id,
      countyFilingNumber: c.countyFilingNumber,
      publicationStatus: result.status,
      blockingReasons: result.blockingReasons,
      hasDuplicateLink: activeDupLinks.length > 0,
      isTaskBlockedOnly: activeDupLinks.length === 0,
      detail: {
        borrowerName: c.borrower?.fullName ?? null,
        grantorName: c.grantor?.fullName ?? null,
        saleDateISO: saleDate ? saleDate.toISOString().slice(0, 10) : null,
        originalPrincipalCents: c.loan?.originalPrincipalAmountCents ?? null,
        address: {
          propertyStreetAddress: c.property?.propertyStreetAddress ?? null,
          city: c.property?.city ?? null,
          addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
          addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
        },
        legalDescription: {
          available: c.legalDescriptions.length > 0 || Boolean(c.property?.subdivision && c.property?.lot),
          subdivision: c.property?.subdivision ?? c.legalDescriptions[0]?.subdivision ?? null,
          lot: c.property?.lot ?? c.legalDescriptions[0]?.lot ?? null,
          block: c.property?.block ?? c.legalDescriptions[0]?.block ?? null,
          rawText: (c.legalDescriptions[0]?.rawText ?? c.property?.legalDescription ?? "").slice(0, 200) || null,
        },
        cad: {
          candidateCount: c.appraisalCandidates.length,
          topCandidateScore: topCandidate?.score ?? null,
          topCandidateOwnerName: topCandidate?.ownerName ?? null,
          topCandidateSitusAddress: topCandidate?.situsAddress ?? null,
          topCandidateMatchedFields: topCandidate?.matchedFields ?? null,
          topCandidateConflictingFields: topCandidate?.conflictingFields ?? null,
          isCadConfirmed: c.appraisalCandidates.some((a) => a.isSelected),
        },
        countyValuation: {
          hasValueHistory: valHist.length > 0,
          latestTaxYear: valHist[0]?.taxYear ?? null,
          latestAppraisedValueCents: valHist[0]?.appraisedValueCents ?? c.property?.appraisedValueCents ?? null,
          certified: valHist[0]?.certified ?? null,
        },
        openManualReviewTasks: c.manualReviewTasks.map((t) => ({ reason: t.reason, notes: t.notes, createdAt: t.createdAt.toISOString() })),
        activeDuplicateLinks: activeDupLinks.map((l) => ({
          otherCaseNumber: (l.caseAId === c.id ? caseById.get(l.caseBId) : caseById.get(l.caseAId))?.caseNumber ?? null,
          confidence: l.confidence,
          score: l.score,
          matchedFields: l.matchedFields,
          conflictingFields: l.conflictingFields,
        })),
        sourceDocument: {
          count: c.documents.length,
          manualReviewStatus: c.documents[0]?.manualReviewStatus ?? null,
          sourceUrl: c.documents[0]?.sourceUrl ?? null,
          rawTextExcerpt: (c.documents[0]?.rawText ?? "").slice(0, 300) || null,
        },
      },
    });
  }

  console.log(`=== Summary ===`);
  console.log(`Total non-public cases found: ${rows.length}`);
  console.log(`Task-blocked (no active duplicate link): ${rows.filter((r) => r.isTaskBlockedOnly).length}`);
  console.log(`Duplicate-link-blocked: ${rows.filter((r) => r.hasDuplicateLink).length}`);
  console.log(`By status: ${JSON.stringify(rows.reduce<Record<string, number>>((acc, r) => { acc[r.publicationStatus] = (acc[r.publicationStatus] ?? 0) + 1; return acc; }, {}))}\n`);

  console.log(`=== TASK-BLOCKED CASES (full detail) ===`);
  for (const r of rows.filter((r) => r.isTaskBlockedOnly)) {
    console.log(`--- ${r.caseNumber} (filing ${r.countyFilingNumber}) | status=${r.publicationStatus} | blocking=${JSON.stringify(r.blockingReasons)} ---`);
    console.log(JSON.stringify(r.detail));
  }

  console.log(`\n=== DUPLICATE-LINK-BLOCKED CASES (case list only, pair detail below) ===`);
  for (const r of rows.filter((r) => r.hasDuplicateLink)) {
    console.log(`--- ${r.caseNumber} (filing ${r.countyFilingNumber}) | status=${r.publicationStatus} | blocking=${JSON.stringify(r.blockingReasons)} ---`);
    console.log(JSON.stringify(r.detail));
  }

  console.log(`\n=== UNIQUE DUPLICATE-LINK PAIRS (full evidence, ${duplicatePairs.length} pairs) ===`);
  for (const p of duplicatePairs) {
    console.log(JSON.stringify(p));
  }

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Freeze failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
