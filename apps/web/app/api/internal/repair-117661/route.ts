import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";

export const maxDuration = 60;

const FORECLOSURE_CASE_ID = "2b405c60-5e81-4699-a6c3-d8a24688e8e0";
const PROPERTY_ID = "6d309c40-688b-4b2c-a351-e704ecda4443";
const WRONG_CANDIDATE_ID = "eb9f8360-ee4c-44c9-875d-efa86e5c9346";

/**
 * One-time repair for document 117661: the pre-CAD-1 matching logic
 * auto-selected an AppraisalPropertyCandidate from subdivision
 * "INSPIRATION ROAD UT NO. 3" even though the notice's own legal
 * description states "BUCHANAN ESTATES" -- CAD-1's subdivision-conflict
 * check (added this session) now correctly rejects this match, but the
 * already-published Property row still carries the wrong candidate's
 * subdivision/lot/block/parcelId/geographicId/lat/long. This does NOT
 * delete the ForeclosureCase -- it only reverts the Property's CAD-derived
 * fields to what the current (fixed) resolver would have produced (no
 * confident CAD match), restores the subdivision from the notice's own
 * legal description, supersedes the wrong candidate's isSelected flag,
 * writes an AuditLog row with the full before/after state, and opens a
 * ManualReviewTask. Same secret-gated, single-use, then-neutered pattern
 * as this directory's other temporary routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read-only: confirm the Property isn't referenced by any OTHER
  // ForeclosureCase before touching it, so this repair can never corrupt
  // an unrelated record that happens to share the same Property row.
  const casesUsingThisProperty = await prisma.foreclosureCase.findMany({
    where: { propertyId: PROPERTY_ID },
    select: { id: true, caseNumber: true },
  });
  const property = await prisma.property.findUnique({ where: { id: PROPERTY_ID } });
  const candidate = await prisma.appraisalPropertyCandidate.findUnique({ where: { id: WRONG_CANDIDATE_ID } });
  const resolutionAttempt = await prisma.propertyResolutionAttempt.findFirst({ where: { foreclosureCaseId: FORECLOSURE_CASE_ID } });
  const existingTasks = await prisma.manualReviewTask.findMany({ where: { foreclosureCaseId: FORECLOSURE_CASE_ID } });

  return NextResponse.json({
    casesUsingThisProperty,
    sharedByMultipleCases: casesUsingThisProperty.length > 1,
    property,
    candidate,
    resolutionAttempt,
    existingTasks,
  });
}

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const casesUsingThisProperty = await prisma.foreclosureCase.findMany({ where: { propertyId: PROPERTY_ID }, select: { id: true } });
    if (casesUsingThisProperty.length !== 1 || casesUsingThisProperty[0]!.id !== FORECLOSURE_CASE_ID) {
      return NextResponse.json(
        { error: "Refusing to repair: Property is not exclusively owned by the expected case.", casesUsingThisProperty },
        { status: 409 },
      );
    }

    const legalDescription = await prisma.legalDescription.findFirst({ where: { foreclosureCaseId: FORECLOSURE_CASE_ID } });
    const propertyBefore = await prisma.property.findUniqueOrThrow({ where: { id: PROPERTY_ID } });
    const candidateBefore = await prisma.appraisalPropertyCandidate.findUniqueOrThrow({ where: { id: WRONG_CANDIDATE_ID } });

    const result = await prisma.$transaction(async (tx) => {
      const updatedProperty = await tx.property.update({
        where: { id: PROPERTY_ID },
        data: {
          // Revert to exactly what the current (CAD-1-fixed) resolver
          // would produce for this case: no confident CAD match, so
          // subdivision/lot/block fall back to the notice's own legal
          // description (never invented), and parcel/geo/lat/long -- all
          // of which came ONLY from the wrong candidate -- are cleared.
          subdivision: legalDescription?.subdivision ?? null,
          lot: legalDescription?.lot ?? null,
          block: legalDescription?.block ?? null,
          propertyIdNumber: null,
          geographicId: null,
          latitude: null,
          longitude: null,
          addressResolutionConfidence: 0.98,
          addressResolutionExplanation:
            "The property street address was explicitly stated in the foreclosure notice. A previously-attached CAD candidate (subdivision \"INSPIRATION ROAD UT NO. 3\") was found to conflict with the notice's own legal description (\"BUCHANAN ESTATES\") and has been removed -- see AuditLog for details. No confident CAD match is currently attached; the street address itself is unaffected.",
        },
      });

      const updatedCandidate = await tx.appraisalPropertyCandidate.update({
        where: { id: WRONG_CANDIDATE_ID },
        data: { isSelected: false },
      });

      const auditLog = await tx.auditLog.create({
        data: {
          actorId: null,
          action: "CORRECT_WRONG_CAD_ENRICHMENT",
          entityType: "Property",
          entityId: PROPERTY_ID,
          beforeJson: {
            foreclosureCaseId: FORECLOSURE_CASE_ID,
            previousSelectedCandidateId: WRONG_CANDIDATE_ID,
            previousSelectedCandidateSourcePropertyId: candidateBefore.sourcePropertyId,
            previousSelectedCandidateSubdivision: candidateBefore.subdivision,
            previousSelectedCandidateSitusAddress: candidateBefore.situsAddress,
            previousPropertySubdivision: propertyBefore.subdivision,
            previousPropertyLot: propertyBefore.lot,
            previousPropertyBlock: propertyBefore.block,
            previousPropertyIdNumber: propertyBefore.propertyIdNumber,
            previousGeographicId: propertyBefore.geographicId,
            previousLatitude: propertyBefore.latitude,
            previousLongitude: propertyBefore.longitude,
            previousConfidence: propertyBefore.addressResolutionConfidence,
            previousExplanation: propertyBefore.addressResolutionExplanation,
          },
          afterJson: {
            reason:
              "The notice's own legal description states subdivision \"BUCHANAN ESTATES\"; the previously-selected CAD candidate's subdivision is \"INSPIRATION ROAD UT NO. 3\" -- a genuine conflict the pre-CAD-1 resolver never checked (it only compared lot/block/owner, not subdivision name). CAD-1's subdivision-conflict check (packages/foreclosure-core/src/address-resolution/resolver.ts, pickEnrichmentCandidate's `fieldConflicts`) now correctly rejects this match.",
            codeVersion: "CAD-matching cleanup pass, commit 6d484f1 and this repair route",
            correctedAt: new Date().toISOString(),
            newPropertySubdivision: updatedProperty.subdivision,
            newPropertyLot: updatedProperty.lot,
            newPropertyBlock: updatedProperty.block,
            candidateSuperseded: WRONG_CANDIDATE_ID,
          },
        },
      });

      const reviewTask = await tx.manualReviewTask.create({
        data: {
          foreclosureCaseId: FORECLOSURE_CASE_ID,
          reason: "MULTIPLE_APPRAISAL_MATCHES",
          status: "OPEN",
          notes:
            "Opened by an automated repair (see AuditLog CORRECT_WRONG_CAD_ENRICHMENT): the previously-auto-selected CAD candidate's subdivision (\"INSPIRATION ROAD UT NO. 3\") conflicted with the notice's own legal description (\"BUCHANAN ESTATES\") and has been removed. No confident replacement candidate is attached -- needs a human search/pick via /admin/property-resolution.",
        },
      });

      return { updatedProperty, updatedCandidate, auditLog, reviewTask };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
