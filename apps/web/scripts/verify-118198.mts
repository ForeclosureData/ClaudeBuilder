/**
 * Read-only re-test of HID-118198 (the case that hit an HTTP 400 during
 * the 10-case pilot) against the CAD robustness fix. Makes ZERO database
 * writes -- this is purely a report to confirm the fix behaves safely
 * before this case is included in the 72-case bulk regeneration run. See
 * docs/DEPLOYMENT.md's pilot report for background.
 */
import { prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, sanitizeCadSearchText, type ResolutionInput } from "@foreclosuredata/foreclosure-core";
import { getCountyAppraisalAdapter } from "../lib/appraisal";

const CASE_ID = "21397060-b5d3-42e7-88b8-8e1cd96eb22d"; // HID-118198

async function main() {
  const fc = await prisma.foreclosureCase.findUniqueOrThrow({
    where: { id: CASE_ID },
    include: { county: true, property: true, borrower: true, grantor: true, currentOwner: true, legalDescriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const legal = fc.legalDescriptions[0];
  const legalForInput = legal
    ? { rawText: legal.rawText, subdivision: legal.subdivision, lot: legal.lot, block: legal.block, acreage: null as number | null }
    : fc.property
      ? { rawText: fc.property.legalDescription, subdivision: fc.property.subdivision, lot: fc.property.lot, block: fc.property.block, acreage: fc.property.acreage }
      : null;
  const ownerNames = [fc.borrower?.fullName, fc.grantor?.fullName, fc.currentOwner?.fullName, ...fc.coOwnerNames].filter((n): n is string => Boolean(n));
  const statedAddressMethod: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE" | null =
    fc.property?.addressResolutionMethod === "EXPLICIT_STATED" ? "EXPLICIT_STATED" : fc.property?.addressResolutionMethod === "COMMONLY_KNOWN_AS_PHRASE" ? "COMMONLY_KNOWN_AS_PHRASE" : null;

  console.log(`=== Read-only re-test: ${fc.caseNumber} (${CASE_ID}) ===`);
  console.log(`Notice address: ${fc.property?.propertyStreetAddress ?? "(none)"}`);
  console.log(`Owner name(s): ${ownerNames.length ? ownerNames.join("; ") : "(unrecoverable -- handwritten annotation obscures grantor name)"}`);
  console.log(`Original legal-description rawText:\n  ${JSON.stringify(legalForInput?.rawText ?? null)}`);

  const sanitized = sanitizeCadSearchText(legalForInput?.rawText ?? null);
  console.log(`Sanitized CAD search query:\n  ${JSON.stringify(sanitized)}`);

  const input: ResolutionInput = {
    statedPropertyAddress: fc.property?.propertyStreetAddress ?? null,
    statedAddressMethod,
    legalDescription: legalForInput,
    ownerNames,
    ownerMailingAddress: fc.borrower?.mailingAddress ?? null,
    propertyIdFromNotice: fc.property?.propertyIdNumber ?? null,
    geographicIdFromNotice: fc.property?.geographicId ?? null,
    city: fc.property?.city ?? null,
  };

  const adapter = getCountyAppraisalAdapter(fc.county.slug);
  const budget = { remaining: 10 };

  let outcome: Awaited<ReturnType<typeof resolvePropertyAddress>> | null = null;
  let errorMessage: string | null = null;
  try {
    outcome = await resolvePropertyAddress(input, adapter, undefined, budget);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  console.log(`\n=== CAD response ===`);
  if (errorMessage) {
    console.log(`ERROR (unrecovered even with the fix): ${errorMessage}`);
  } else if (outcome) {
    console.log(`Requests used: ${outcome.requestsUsed}`);
    console.log(`Candidates found: ${outcome.candidates.length}`);
    for (const c of outcome.candidates) {
      console.log(`  - sourcePropertyId=${c.sourcePropertyId} situsAddress=${JSON.stringify(c.situsAddress)} parcelId=${c.parcelId} geoId=${c.geographicId} ownerName=${JSON.stringify(c.ownerName)} subdivision=${JSON.stringify(c.subdivision)} lot=${c.lot} block=${c.block}`);
    }
    console.log(`Confidence: ${outcome.resolution.confidence}`);
    console.log(`Matched fields: ${JSON.stringify(outcome.resolution.matchedFields)}`);
    console.log(`Conflicting fields: ${JSON.stringify(outcome.resolution.conflictingFields)}`);
    console.log(`Owner-conflict-on-best-match: ${outcome.ownerConflictOnBestMatch} (note: owner name is unrecoverable for this case, so this check has nothing to compare against and can never fire -- a structural limitation, not a bug)`);
    console.log(`Selected/enrichment candidate: ${outcome.selectedCandidate ? JSON.stringify({ sourcePropertyId: outcome.selectedCandidate.sourcePropertyId, situsAddress: outcome.selectedCandidate.situsAddress }) : "none (no single unambiguous match)"}`);
    console.log(`Requires manual review: ${outcome.resolution.requiresManualReview}`);
    console.log(`\nViable candidate exists: ${outcome.candidates.length > 0 ? "yes" : "no"}`);
    console.log(`Would this case get CAD-enrichment auto-attached (per pilot script logic): ${outcome.selectedCandidate ? "YES -- REVIEW CAREFULLY, see note on unrecoverable owner name above" : "no -- correctly requires human review or found nothing"}`);
  }

  console.log(`\nNo database writes were made by this script -- read-only verification only.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
