/**
 * Read-only reconciliation of the 82 legacy-seeded Hidalgo ForeclosureCase
 * rows (created by prisma/seed.ts from hidalgo-real-cases.ts, manually
 * transcribed pre-pipeline) against the 282 automated-ingestion cases from
 * the current bundle. Zero database writes, zero Anthropic calls.
 *
 * Why this exists: prisma/seed.ts's seedRealCase() never sets
 * ForeclosureCase.countyFilingNumber -- it only stores the notice's filing
 * number (c.docNumber) on the related SourceDocument.countyFilingNumber and
 * on ForeclosureCase.caseNumber as "HID-{docNumber}". That means the
 * (countyId, countyFilingNumber) duplicate-group check used throughout this
 * project's batch reports NEVER sees these 82 rows -- Postgres doesn't
 * treat NULL as colliding with a real value under the unique constraint, so
 * a legacy row and an ingested row sharing the same real-world filing
 * number would silently coexist, invisible to every prior duplicate check.
 *
 * For each of the 82 legacy cases, classifies against the 282 ingested
 * cases as:
 *   A - same county filing (docNumber exactly matches an ingested
 *       countyFilingNumber)
 *   B - same foreclosure event under a different filing number (strong
 *       fuzzy-evidence match: instrument number, or 3+ of address/legal
 *       description/borrower/sale date/DOT date/principal/lender)
 *   C - legitimate notice outside the current 282 bundle (no meaningful
 *       evidence overlap with any ingested case)
 *   D - synthetic/demo-only data (not expected; hidalgo-real-cases.ts is
 *       documented as manually transcribed from real recorded notices)
 *   E - unable to determine (some weak evidence, but not enough to call B
 *       or confidently rule out C)
 */
import { prisma } from "@foreclosuredata/database";
import { normalizeOwnerName } from "@foreclosuredata/foreclosure-core";
import { realHidalgoCases } from "../../../packages/database/prisma/hidalgo-real-cases.ts";

function normAddr(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.trim().toUpperCase().replace(/[.,#]/g, "").replace(/\s+/g, " ");
}

function normLegal(subdivision: string | null | undefined, lot: string | null | undefined, block: string | null | undefined): string | null {
  const parts = [subdivision, lot, block].filter(Boolean).map((s) => s!.trim().toUpperCase().replace(/\s+/g, " "));
  return parts.length ? parts.join("|") : null;
}

function ownerTokens(raw: string): Set<string> {
  const n = normalizeOwnerName(raw);
  const tokens = new Set<string>();
  for (const v of n.normalizedVariants) {
    for (const t of v.split(/\s+/).filter((t) => t.length > 1)) tokens.add(t);
  }
  return tokens;
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

interface IngestedRow {
  id: string;
  caseNumber: string | null;
  countyFilingNumber: string | null;
  borrowerName: string | null;
  grantorName: string | null;
  address: string | null;
  legal: string | null;
  saleDateISO: string | null;
  dotDateISO: string | null;
  principalCents: number | null;
  instrumentNumber: string | null;
  lenderName: string | null;
}

async function main() {
  console.log(`=== Legacy vs. ingested reconciliation (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  const allCases = await prisma.foreclosureCase.findMany({
    where: { archivedAt: null },
    include: {
      borrower: true,
      grantor: true,
      loan: { include: { currentMortgagee: true } },
      sales: true,
      legalDescriptions: true,
      property: true,
      documents: { select: { countyFilingNumber: true } },
    },
  });

  console.log(`Total non-archived ForeclosureCase rows: ${allCases.length}`);

  const legacyDb = allCases.filter((c) => c.countyFilingNumber === null);
  const ingestedDb = allCases.filter((c) => c.countyFilingNumber !== null);
  console.log(`Rows with ForeclosureCase.countyFilingNumber IS NULL (legacy-seed marker): ${legacyDb.length}`);
  console.log(`Rows with ForeclosureCase.countyFilingNumber set (automated ingestion): ${ingestedDb.length}\n`);

  const ingested: IngestedRow[] = ingestedDb.map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    countyFilingNumber: c.countyFilingNumber,
    borrowerName: c.borrower?.fullName ?? null,
    grantorName: c.grantor?.fullName ?? null,
    address: normAddr(c.property?.propertyStreetAddress),
    legal: normLegal(c.legalDescriptions[0]?.subdivision ?? c.property?.subdivision, c.legalDescriptions[0]?.lot ?? c.property?.lot, c.legalDescriptions[0]?.block ?? c.property?.block),
    saleDateISO: c.sales[0]?.saleDate ? c.sales[0].saleDate.toISOString().slice(0, 10) : null,
    dotDateISO: null,
    principalCents: null,
    instrumentNumber: null,
    lenderName: c.loan?.currentMortgagee?.name ?? null,
  }));

  // Loan fields need a second pass since Loan isn't unique-typed on include above for principal/DOT date
  const loanByCase = new Map((await prisma.loan.findMany({ where: { foreclosureCaseId: { in: ingestedDb.map((c) => c.id) } } })).map((l) => [l.foreclosureCaseId, l]));
  for (const row of ingested) {
    const l = loanByCase.get(row.id);
    if (l) {
      row.dotDateISO = l.deedOfTrustDate ? l.deedOfTrustDate.toISOString().slice(0, 10) : null;
      row.principalCents = l.originalPrincipalAmountCents ?? null;
      row.instrumentNumber = l.instrumentNumber ?? null;
    }
  }

  const byExactFiling = new Map(ingested.map((r) => [r.countyFilingNumber, r]));
  const byInstrumentNumber = new Map(ingested.filter((r) => r.instrumentNumber).map((r) => [r.instrumentNumber, r]));

  const legacyByCaseNumber = new Map(legacyDb.map((c) => [c.caseNumber, c]));

  const results: Array<{
    docNumber: string;
    dbFound: boolean;
    category: "A" | "B" | "C" | "D" | "E";
    matchedFilingNumber: string | null;
    evidence: string[];
    note: string;
  }> = [];

  for (const c of realHidalgoCases) {
    const expectedCaseNumber = `HID-${c.docNumber}`;
    const dbRow = legacyByCaseNumber.get(expectedCaseNumber);
    if (!dbRow) {
      results.push({ docNumber: c.docNumber, dbFound: false, category: "E", matchedFilingNumber: null, evidence: [], note: "No legacy DB row found with this caseNumber -- data-integrity gap, investigate separately." });
      continue;
    }

    // Category A: exact filing-number overlap.
    const exact = byExactFiling.get(c.docNumber);
    if (exact) {
      results.push({
        docNumber: c.docNumber,
        dbFound: true,
        category: "A",
        matchedFilingNumber: exact.countyFilingNumber,
        evidence: ["exact countyFilingNumber match"],
        note: `Legacy docNumber ${c.docNumber} IS an ingested countyFilingNumber (case ${exact.caseNumber}). Same county filing exists as two separate ForeclosureCase rows.`,
      });
      continue;
    }

    // Category B candidate: instrument-number match (very strong -- same recorded Deed of Trust).
    const legacyInstr = c.instrumentNumber;
    if (legacyInstr && byInstrumentNumber.has(legacyInstr)) {
      const m = byInstrumentNumber.get(legacyInstr)!;
      results.push({
        docNumber: c.docNumber,
        dbFound: true,
        category: "B",
        matchedFilingNumber: m.countyFilingNumber,
        evidence: ["instrumentNumber exact match"],
        note: `Legacy instrument number ${legacyInstr} matches ingested case ${m.caseNumber} (filing ${m.countyFilingNumber}) -- same recorded Deed of Trust, different notice-of-sale filing.`,
      });
      continue;
    }

    // Fuzzy evidence scoring against every ingested row.
    const legacyAddr = normAddr(c.address);
    const legacyLegal = normLegal(c.subdivision, c.lot, c.block);
    const legacyTokens = c.grantorNames ? ownerTokens(c.grantorNames) : new Set<string>();

    let best: { row: IngestedRow; fields: string[] } | null = null;
    for (const row of ingested) {
      const fields: string[] = [];
      if (legacyAddr && row.address && legacyAddr === row.address) fields.push("address");
      if (legacyLegal && row.legal && legacyLegal === row.legal) fields.push("legalDescription");
      if (c.saleDateISO && row.saleDateISO && c.saleDateISO === row.saleDateISO) fields.push("saleDate");
      if (c.dotDateISO && row.dotDateISO && c.dotDateISO === row.dotDateISO) fields.push("deedOfTrustDate");
      if (c.principalCents !== null && row.principalCents !== null && c.principalCents === row.principalCents) fields.push("originalPrincipalAmount");
      if (c.currentMortgagee && row.lenderName && c.currentMortgagee.trim().toUpperCase() === row.lenderName.trim().toUpperCase()) fields.push("lenderName");
      if (legacyTokens.size && row.borrowerName) {
        const overlap = tokenOverlap(legacyTokens, ownerTokens(row.borrowerName));
        if (overlap >= 0.6) fields.push("borrowerNames");
      }
      if (!best || fields.length > best.fields.length) best = { row, fields };
    }

    if (best && best.fields.length >= 3) {
      results.push({
        docNumber: c.docNumber,
        dbFound: true,
        category: "B",
        matchedFilingNumber: best.row.countyFilingNumber,
        evidence: best.fields,
        note: `Strong fuzzy match to ingested case ${best.row.caseNumber} (filing ${best.row.countyFilingNumber}) on ${best.fields.length} independent fields: ${best.fields.join(", ")}.`,
      });
    } else if (best && best.fields.length >= 1) {
      results.push({
        docNumber: c.docNumber,
        dbFound: true,
        category: "E",
        matchedFilingNumber: best.row.countyFilingNumber,
        evidence: best.fields,
        note: `Only weak evidence overlap with ingested case ${best.row.caseNumber} (filing ${best.row.countyFilingNumber}) on: ${best.fields.join(", ")}. Not enough independent fields to call this the same event confidently.`,
      });
    } else {
      results.push({
        docNumber: c.docNumber,
        dbFound: true,
        category: "C",
        matchedFilingNumber: null,
        evidence: [],
        note: `No evidence overlap found with any of the ${ingested.length} ingested cases. Appears to be a legitimate notice outside the current 282-notice bundle (or from a different posting/date range).`,
      });
    }
  }

  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const r of results) counts[r.category]++;

  console.log(`=== Classification counts (of ${realHidalgoCases.length} legacy cases) ===`);
  console.log(JSON.stringify(counts, null, 2));
  console.log();

  console.log(`=== Full per-case detail ===`);
  console.log(JSON.stringify(results, null, 2));
  console.log();

  const aAndB = results.filter((r) => r.category === "A" || r.category === "B");
  console.log(`=== Investor-facing duplication check ===`);
  console.log(`Legacy cases in category A or B: ${aAndB.length} -- each of these exists as TWO non-archived ForeclosureCase rows today (the legacy row and its matched ingested row), and with no publication gate yet, BOTH are currently visible on the public site as separate listings for the same real-world property/event.`);
  console.log();

  console.log(`=== Recommended active-case count for this bundle ===`);
  const trueUniqueLegacy = counts.C + counts.D; // legacy rows genuinely outside the 282, worth keeping as their own cases
  console.log(`282 ingested (automated pipeline) + ${trueUniqueLegacy} legacy rows genuinely outside the bundle (category C/D) = ${282 + trueUniqueLegacy} correct active-case count.`);
  console.log(`Currently showing ${legacyDb.length + ingestedDb.length} non-archived rows -- ${counts.A + counts.B} of which (category A/B) are redundant legacy duplicates of an ingested case.`);

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
