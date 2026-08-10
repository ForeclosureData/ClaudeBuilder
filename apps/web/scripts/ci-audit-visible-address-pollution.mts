/**
 * Phase 2 of the beta-readiness pass: read-only audit of every currently
 * investor-visible listing (PUBLISHED / PUBLISHED_WITH_LIMITED_DATA) for
 * the same trustee/lender/courthouse/law-firm address-pollution pattern
 * found and fixed among the 55 blocked cases. Zero writes, zero Anthropic
 * calls -- this script only REPORTS candidates; any correction happens in
 * a separate, explicitly-reviewed mutation pass.
 *
 * Method: exact-string repetition of propertyStreetAddress across
 * DISTINCT cases/borrowers (the same structural signal
 * isRepeatedAcrossCases() already guards on new ingestion), plus a
 * keyword search of the surrounding source-notice raw text to classify
 * *why* the address appears (trustee/lender/courthouse/law-firm/mailing
 * context) versus a genuine property address.
 */
import { prisma } from "@foreclosuredata/database";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "@foreclosuredata/foreclosure-core";

const ROLE_KEYWORDS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "TRUSTEE OFFICE", patterns: [/substitute trustee'?s?\s+address/i, /trustee'?s?\s+address/i, /trustee:.{0,80}address/is] },
  { label: "LENDER/MORTGAGEE OFFICE", patterns: [/lender'?s?\s+address/i, /mortgagee'?s?\s+address/i, /beneficiary'?s?\s+address/i, /servicer'?s?\s+address/i] },
  { label: "COURTHOUSE", patterns: [/county courthouse/i, /317 n\.?\s*closner/i, /courthouse door/i] },
  { label: "LAW FIRM", patterns: [/attorney at law/i, /law firm/i, /law office/i, /,\s*p\.?c\.?\b/i, /,\s*l\.?l\.?p\.?\b/i] },
  { label: "MAILING/RETURN ADDRESS", patterns: [/return to:/i, /after recording,?\s*return to/i, /return address/i, /prepared by/i] },
];

function classifyAddressContext(rawText: string | null, address: string): { label: string; snippet: string | null } {
  if (!rawText) return { label: "AMBIGUOUS", snippet: null };
  const idx = rawText.toLowerCase().indexOf(address.toLowerCase());
  const windowStart = idx >= 0 ? Math.max(0, idx - 200) : 0;
  const windowEnd = idx >= 0 ? Math.min(rawText.length, idx + address.length + 50) : Math.min(rawText.length, 2000);
  const window = rawText.slice(windowStart, windowEnd);
  for (const role of ROLE_KEYWORDS) {
    for (const pattern of role.patterns) {
      if (pattern.test(window)) return { label: role.label, snippet: window.replace(/\s+/g, " ").trim().slice(0, 300) };
    }
  }
  // Broader document-level scan in case the label appears elsewhere but the
  // address itself was reused from that section without being adjacent to it.
  for (const role of ROLE_KEYWORDS) {
    for (const pattern of role.patterns) {
      if (pattern.test(rawText)) return { label: role.label, snippet: window.replace(/\s+/g, " ").trim().slice(0, 300) || null };
    }
  }
  return { label: "AMBIGUOUS", snippet: window.replace(/\s+/g, " ").trim().slice(0, 300) || null };
}

async function main() {
  console.log(`=== Global visible-listing address-pollution audit (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

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
      duplicateLinksAsCaseA: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
      duplicateLinksAsCaseB: { where: { status: "OPEN", confidence: { in: ["CONFIRMED_SAME_EVENT", "LIKELY_SAME_EVENT"] } }, select: { id: true }, take: 1 },
    },
  });

  const visible: typeof cases = [];
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
    if (isPubliclyVisibleStatus(computePublicationStatus(input).status)) visible.push(c);
  }
  console.log(`Total investor-visible listings audited: ${visible.length}\n`);

  const addrMap = new Map<string, typeof visible>();
  for (const c of visible) {
    const a = c.property?.propertyStreetAddress?.trim().toUpperCase();
    if (!a) continue;
    const arr = addrMap.get(a) ?? [];
    arr.push(c);
    addrMap.set(a, arr);
  }

  const suspicious = [...addrMap.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`=== Repeated addresses among visible listings (candidate pollution) ===`);
  console.log(`Distinct addresses shared by >=2 visible cases: ${suspicious.length}\n`);

  let totalSuspiciousCases = 0;
  let nonPropertyCount = 0;
  for (const [addr, group] of suspicious.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- "${addr}" shared by ${group.length} visible cases ---`);
    for (const c of group) {
      const rawText = c.documents[0]?.rawText ?? null;
      const classification = classifyAddressContext(rawText, c.property?.propertyStreetAddress ?? addr);
      totalSuspiciousCases++;
      if (classification.label !== "PROPERTY" && classification.label !== "AMBIGUOUS") nonPropertyCount++;
      console.log(`  ${c.caseNumber} | filing=${c.countyFilingNumber} | borrower=${c.borrower?.fullName ?? "null"} | classification=${classification.label}`);
      console.log(`    context: ${classification.snippet ?? "(no rawText / no keyword match)"}`);
    }
    console.log();
  }

  console.log(`=== Summary ===`);
  console.log(`Visible cases involved in a repeated-address cluster: ${totalSuspiciousCases}`);
  console.log(`Of those, classified as a non-property role address (TRUSTEE/LENDER/COURTHOUSE/LAW FIRM/MAILING): ${nonPropertyCount}`);
  console.log(`No automatic mutation performed -- this is a read-only report.`);

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
