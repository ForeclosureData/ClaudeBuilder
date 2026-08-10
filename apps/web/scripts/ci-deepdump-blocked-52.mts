/**
 * Phase 1 support for the beta-readiness pass: full-text dump (not the
 * 300-char excerpt used in the earlier triage) of the 52 still-blocked
 * cases, so a human reviewer can actually read the source notice instead
 * of guessing from a snippet. Read-only, zero writes, zero Anthropic calls.
 */
import { prisma } from "@foreclosuredata/database";

const STILL_BLOCKED = [
  "HID-117631", "HID-118005", "HID-117634", "HID-117643", "HID-117651", "HID-117652", "HID-117658", "HID-117660", "HID-117661",
  "HID-117675", "HID-117697", "HID-117698", "HID-117695", "HID-117701", "HID-117702", "HID-117718", "HID-117888", "HID-117908",
  "HID-117915", "HID-117913", "HID-117919", "HID-117921", "HID-118016", "HID-118014", "HID-117932", "HID-117933", "HID-117935",
  "HID-117944", "HID-117959", "HID-117961", "HID-117962", "HID-117988", "HID-117989", "HID-118000", "HID-118055",
  "HID-118067", "HID-118069", "HID-118087", "HID-118094", "HID-118149", "HID-118116", "HID-118125", "HID-118124", "HID-118128",
  "HID-118150", "HID-118147", "HID-118151", "HID-118152", "HID-118154", "HID-118163", "HID-118153", "HID-118176",
];

async function main() {
  console.log(`=== Deep dump: 52 still-blocked cases (${new Date().toISOString()}) ===`);
  console.log(`Mode: read-only (zero writes, zero Anthropic calls)\n`);

  for (const caseNumber of STILL_BLOCKED) {
    const fc = await prisma.foreclosureCase.findFirst({
      where: { caseNumber, archivedAt: null },
      include: {
        borrower: { select: { fullName: true } },
        grantor: { select: { fullName: true } },
        property: true,
        sales: true,
        loan: { include: { currentMortgagee: { select: { name: true } }, originalLender: { select: { name: true } } } },
        legalDescriptions: true,
        documents: true,
        manualReviewTasks: { where: { status: "OPEN" }, select: { reason: true, notes: true } },
        appraisalCandidates: { select: { ownerName: true, situsAddress: true, parcelId: true, legalDescription: true, subdivision: true, lot: true, block: true, isSelected: true } },
      },
    });
    if (!fc) {
      console.log(`--- ${caseNumber}: NOT FOUND (state changed) ---\n`);
      continue;
    }
    console.log(`--- ${caseNumber} (filing ${fc.countyFilingNumber}) ---`);
    console.log(`borrower=${fc.borrower?.fullName ?? "null"} | grantor=${fc.grantor?.fullName ?? "null"}`);
    console.log(`address=${fc.property?.propertyStreetAddress ?? "null"} method=${fc.property?.addressResolutionMethod ?? "null"}`);
    console.log(`legalDesc(property)=${JSON.stringify({ subdivision: fc.property?.subdivision, lot: fc.property?.lot, block: fc.property?.block })}`);
    console.log(`legalDescriptions(rows)=${JSON.stringify(fc.legalDescriptions.map((l) => ({ rawText: l.rawText, subdivision: l.subdivision, lot: l.lot, block: l.block })))}`);
    console.log(`sales=${JSON.stringify(fc.sales.map((s) => ({ saleDate: s.saleDate, saleTime: s.saleTime, saleLocation: s.saleLocation, saleStatus: s.saleStatus, noticePostingDate: s.noticePostingDate })))}`);
    console.log(`loan=${JSON.stringify({ principal: fc.loan?.originalPrincipalAmountCents, dot: fc.loan?.deedOfTrustDate, instr: fc.loan?.instrumentNumber, mortgagee: fc.loan?.currentMortgagee?.name, lender: fc.loan?.originalLender?.name })}`);
    console.log(`openTasks=${JSON.stringify(fc.manualReviewTasks)}`);
    console.log(`cadCandidates=${JSON.stringify(fc.appraisalCandidates)}`);
    for (const doc of fc.documents) {
      console.log(`--- rawText (doc ${doc.id}, filingDate=${doc.filingDate}) ---`);
      console.log(doc.rawText ?? "(null)");
    }
    console.log(`--- END ${caseNumber} ---\n`);
  }

  console.log(`Done.`);
}

main()
  .catch((err) => {
    console.error("Deep dump failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
