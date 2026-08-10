/**
 * Phase 2 execution for the beta-readiness pass: corrects the
 * trustee/courthouse/lender address-pollution cases found by
 * ci-audit-visible-address-pollution.mts among currently investor-visible
 * listings. Same mechanism as the earlier blocked-55 address corrections
 * (null the bogus field, never guess a replacement) -- the live
 * publication-status computation then naturally drops any case that no
 * longer has a trustworthy address AND no legal description back to
 * PENDING_REVIEW/WITHHELD, so a wrong address is never left public.
 *
 * Three evidenced clusters, all confirmed by exact-string reuse across
 * unrelated cases plus in-text role labeling:
 *   - 19 cases: "902 Bighorn Drive, Edinburg, Texas 78542" -- raw text
 *     labels it "Trustee's Address" / "Substitute Trustee's Address"
 *     (trustee: Timothy Sers) across 19 different borrowers/lenders.
 *   - 3 cases: "317 N Closner, Edinburg TX 78539" -- the Hidalgo County
 *     Courthouse, the notice's own stated SALE LOCATION, not the property.
 *   - 3 cases: "520 E. Nolana Ave, McAllen, Texas 78504" -- explicitly the
 *     noteholder/lender's ("Lone Star National Bank") mailing address per
 *     the notice text.
 *
 * DRY_RUN=true (default): zero writes. DRY_RUN=false: executes, with an
 * AuditLog before/after entry for every Property row touched.
 */
import { prisma } from "@foreclosuredata/database";

const DRY_RUN = process.env.DRY_RUN !== "false";

interface Correction {
  caseNumber: string;
  expectedBogusAddress: string;
  evidence: string;
}

const TRUSTEE_CASES = [
  "HID-118165", "HID-118162", "HID-118164", "HID-118169", "HID-118167", "HID-118170", "HID-118173", "HID-118172", "HID-118175",
  "HID-118174", "HID-118166", "HID-118171", "HID-118168", "HID-118180", "HID-118182", "HID-118179", "HID-118178", "HID-118177",
  "HID-118181",
];
const COURTHOUSE_CASES = ["HID-117719", "HID-117721", "HID-117896"];
const LENDER_CASES = ["HID-118131", "HID-118129", "HID-118130"];

const CORRECTIONS: Correction[] = [
  ...TRUSTEE_CASES.map((caseNumber) => ({
    caseNumber,
    expectedBogusAddress: "902 Bighorn Drive, Edinburg, Texas 78542",
    evidence: "Raw notice text labels this \"Trustee's Address\"/\"Substitute Trustee's Address\" (Trustee: Timothy Sers). Exact match shared by 19 unrelated visible cases with different borrowers and lenders.",
  })),
  ...COURTHOUSE_CASES.map((caseNumber) => ({
    caseNumber,
    expectedBogusAddress: "317 N Closner, Edinburg TX 78539",
    evidence: "317 N. Closner Blvd is the Hidalgo County Courthouse -- the notice's own stated sale LOCATION (\"Place: Hidalgo County Courthouse... 317 N Closner, Edinburg TX 78539\"), not the foreclosed property. Exact match shared by 3 unrelated visible cases.",
  })),
  ...LENDER_CASES.map((caseNumber) => ({
    caseNumber,
    expectedBogusAddress: "520 E. Nolana Ave, McAllen, Texas 78504",
    evidence: "Raw notice text ties this address to the noteholder/lender (\"payable to the order of Lone Star National Bank, 520 E. Nolana Ave, McAllen, Texas 78504 (the \\\"Noteholder\\\")\"), not the foreclosed property. Exact match shared by 3 unrelated visible cases.",
  })),
];

async function main() {
  console.log(`=== Visible-listing address-pollution correction (${new Date().toISOString()}) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (zero writes)" : "LIVE (will mutate production)"}\n`);

  let corrected = 0;
  let skipped = 0;
  for (const c of CORRECTIONS) {
    const fc = await prisma.foreclosureCase.findFirst({ where: { caseNumber: c.caseNumber, archivedAt: null }, include: { property: true } });
    if (!fc || !fc.property) {
      console.log(`SKIP ${c.caseNumber}: case or property not found.\n`);
      skipped++;
      continue;
    }
    const currentAddr = (fc.property.propertyStreetAddress ?? "").trim().toUpperCase();
    if (currentAddr !== c.expectedBogusAddress.trim().toUpperCase()) {
      console.log(`SKIP ${c.caseNumber}: current address "${fc.property.propertyStreetAddress}" no longer matches expected bogus value -- state changed since audit, not touching.\n`);
      skipped++;
      continue;
    }
    const before = { propertyStreetAddress: fc.property.propertyStreetAddress, addressResolutionMethod: fc.property.addressResolutionMethod, addressResolutionConfidence: fc.property.addressResolutionConfidence, addressResolutionExplanation: fc.property.addressResolutionExplanation };
    const after = { propertyStreetAddress: null, addressResolutionMethod: "UNRESOLVED" as const, addressResolutionConfidence: null, addressResolutionExplanation: `Corrected via beta-readiness visible-listing audit: extracted address was a trustee/lender/courthouse address, not the foreclosed property. ${c.evidence} Original value: "${before.propertyStreetAddress}".` };
    console.log(`${c.caseNumber}: property ${fc.property.id} -- clearing bogus address "${before.propertyStreetAddress}". Evidence: ${c.evidence}`);
    if (DRY_RUN) {
      console.log(`  DRY RUN: no writes performed.\n`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.property.update({ where: { id: fc.property!.id }, data: after });
      await tx.auditLog.create({ data: { actorId: null, action: "CORRECT_VISIBLE_LISTING_ADDRESS_MISATTRIBUTION", entityType: "Property", entityId: fc.property!.id, beforeJson: before, afterJson: after } });
    });
    console.log(`  LIVE: corrected.\n`);
    corrected++;
  }

  console.log(`=== Summary: ${corrected} corrected, ${skipped} skipped (of ${CORRECTIONS.length} candidates) ===`);
  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error("Correction failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
