import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { normalizeCountyFilingNumber, chooseCanonicalCase, type CanonicalCandidateInput } from "@foreclosuredata/foreclosure-core";

export const maxDuration = 60;

/**
 * Read-only dry-run report for the dedup cleanup: groups every SourceDocument
 * by (countyId, normalized countyFilingNumber) -- the same identity key
 * processSingleNotice now checks -- and, for every group with more than one
 * row, dumps each duplicate's timestamp/resolution/address/parcel/child-record
 * state plus the canonical pick chooseCanonicalCase() would make and why.
 * Makes NO writes. Retired to a 410 stub after producing the report, same as
 * this directory's other temporary diagnostic routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await buildReport();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}

async function buildReport() {
  const documents = await prisma.sourceDocument.findMany({
    where: { countyFilingNumber: { not: null } },
    select: {
      id: true,
      countyId: true,
      countyFilingNumber: true,
      documentUrl: true,
      createdAt: true,
      foreclosureCaseId: true,
      foreclosureCase: {
        select: {
          id: true,
          caseNumber: true,
          countyFilingNumber: true,
          status: true,
          archivedAt: true,
          createdAt: true,
          summaryText: true,
          property: {
            select: {
              id: true,
              propertyStreetAddress: true,
              city: true,
              zipCode: true,
              subdivision: true,
              lot: true,
              block: true,
              propertyIdNumber: true,
              geographicId: true,
              addressResolutionMethod: true,
              addressResolutionConfidence: true,
              addressResolutionExplanation: true,
            },
          },
          loan: {
            select: {
              originalLenderOrgId: true,
              currentMortgageeOrgId: true,
              mortgageServicerOrgId: true,
              originalPrincipalAmountCents: true,
              instrumentNumber: true,
              recordingDate: true,
              currentPrincipalBalanceCents: true,
              estimatedRemainingBalanceCents: true,
            },
          },
          sales: { select: { id: true, saleDate: true, saleTime: true, saleLocation: true, trusteeId: true } },
          documents: { select: { id: true } },
          addressCandidates: { select: { id: true } },
          legalDescriptions: { select: { id: true, rawText: true } },
          manualReviewTasks: { select: { id: true, reason: true, status: true } },
          correctionReports: { select: { id: true } },
          processingJobs: { select: { id: true } },
          appraisalCandidates: {
            select: { id: true, sourcePropertyId: true, situsAddress: true, score: true, isSelected: true, matchedFields: true, conflictingFields: true },
          },
          resolutionAttempts: { select: { id: true, resolutionMethod: true, confidence: true, explanation: true, createdAt: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  type CaseGroupEntry = (typeof documents)[number];
  const groups = new Map<string, CaseGroupEntry[]>();
  for (const doc of documents) {
    if (!doc.foreclosureCase) continue;
    const normalized = normalizeCountyFilingNumber(doc.countyFilingNumber);
    if (!normalized) continue;
    const key = `${doc.countyId}::${normalized}`;
    const existing = groups.get(key);
    if (existing) existing.push(doc);
    else groups.set(key, [doc]);
  }

  const totalSourceDocuments = documents.length;
  const distinctFilingNumbers = groups.size;
  const duplicateGroups = [...groups.entries()].filter(([, docs]) => docs.length > 1);

  const report = duplicateGroups.map(([key, docs]) => {
    const [countyId, normalizedFilingNumber] = key.split("::");

    const canonicalInputs: CanonicalCandidateInput[] = docs.map((doc) => {
      const c = doc.foreclosureCase!;
      const selectedCandidate = c.appraisalCandidates.find((cand) => cand.isSelected);
      const loanFieldsPopulated = c.loan
        ? [
            c.loan.originalLenderOrgId,
            c.loan.currentMortgageeOrgId,
            c.loan.mortgageServicerOrgId,
            c.loan.originalPrincipalAmountCents,
            c.loan.instrumentNumber,
            c.loan.recordingDate,
            c.loan.currentPrincipalBalanceCents,
            c.loan.estimatedRemainingBalanceCents,
          ].filter((v) => v !== null && v !== undefined).length
        : 0;
      const saleFieldsPopulated = c.sales.reduce(
        (sum, s) => sum + [s.saleDate, s.saleTime, s.saleLocation, s.trusteeId].filter((v) => v !== null && v !== undefined).length,
        0,
      );
      const extractedDataCompletenessCount =
        loanFieldsPopulated + saleFieldsPopulated + (c.summaryText ? 1 : 0) + c.legalDescriptions.filter((ld) => ld.rawText).length;

      return {
        caseId: c.id,
        createdAt: c.createdAt.toISOString(),
        hasProperty: !!c.property,
        addressResolutionMethod: c.property?.addressResolutionMethod ?? null,
        addressResolutionConfidence: c.property?.addressResolutionConfidence ?? null,
        selectedAppraisalCandidateScore: selectedCandidate?.score ?? null,
        extractedDataCompletenessCount,
        resolvedManualReviewTaskCount: c.manualReviewTasks.filter((t) => t.status === "RESOLVED").length,
      };
    });

    const selection = chooseCanonicalCase(canonicalInputs);

    const rows = docs.map((doc) => {
      const c = doc.foreclosureCase!;
      const scoreEntry = selection.scoredCandidates.find((s) => s.caseId === c.id);
      const selectedCandidate = c.appraisalCandidates.find((cand) => cand.isSelected);
      return {
        sourceDocumentId: doc.id,
        foreclosureCaseId: c.id,
        caseNumber: c.caseNumber,
        documentUrl: doc.documentUrl,
        createdAt: c.createdAt.toISOString(),
        status: c.status,
        alreadyArchived: !!c.archivedAt,
        isProposedCanonical: c.id === selection.canonicalCaseId,
        score: scoreEntry?.score ?? null,
        scoreBreakdown: scoreEntry?.scoreBreakdown ?? null,
        resolution: {
          method: c.property?.addressResolutionMethod ?? null,
          confidence: c.property?.addressResolutionConfidence ?? null,
          explanation: c.property?.addressResolutionExplanation ?? null,
        },
        propertyAddress: c.property
          ? { street: c.property.propertyStreetAddress, city: c.property.city, zip: c.property.zipCode }
          : null,
        parcelMatch: c.property
          ? {
              subdivision: c.property.subdivision,
              lot: c.property.lot,
              block: c.property.block,
              propertyIdNumber: c.property.propertyIdNumber,
              geographicId: c.property.geographicId,
            }
          : null,
        selectedAppraisalCandidate: selectedCandidate
          ? { sourcePropertyId: selectedCandidate.sourcePropertyId, situsAddress: selectedCandidate.situsAddress, score: selectedCandidate.score }
          : null,
        childRecordCounts: {
          sourceDocuments: c.documents.length,
          sales: c.sales.length,
          hasLoan: !!c.loan,
          addressCandidates: c.addressCandidates.length,
          legalDescriptions: c.legalDescriptions.length,
          manualReviewTasks: c.manualReviewTasks.length,
          appraisalCandidates: c.appraisalCandidates.length,
          resolutionAttempts: c.resolutionAttempts.length,
          correctionReports: c.correctionReports.length,
          processingJobs: c.processingJobs.length,
        },
        openManualReviewReasons: c.manualReviewTasks.filter((t) => t.status === "OPEN").map((t) => t.reason),
      };
    });

    return {
      countyId,
      normalizedFilingNumber,
      duplicateRowCount: docs.length,
      proposedCanonicalCaseId: selection.canonicalCaseId,
      canonicalSelectionReasoning: selection.reasoning,
      tieBreakUsed: selection.tieBreakUsed,
      rows,
    };
  });

  return NextResponse.json({
    totalSourceDocumentsWithFilingNumber: totalSourceDocuments,
    distinctFilingNumbers,
    duplicateFilingNumberGroupCount: duplicateGroups.length,
    duplicateRowTotal: duplicateGroups.reduce((sum, [, docs]) => sum + docs.length, 0),
    extraRowsBeyondCanonical: duplicateGroups.reduce((sum, [, docs]) => sum + docs.length - 1, 0),
    groups: report,
  });
}
