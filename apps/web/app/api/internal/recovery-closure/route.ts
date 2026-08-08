import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { normalizeCountyFilingNumber } from "@foreclosuredata/foreclosure-core";

export const maxDuration = 60;

const ORPHANED_AUDIT_ENTRY_ID = "693103e3-dc4d-408e-864c-a4ad40eb8de8";
const ANNOTATE_ACTION = "ANNOTATE_ORPHANED_AUDIT_ENTRY";

/**
 * Recovery-incident closure: (1) idempotently appends a clarifying AuditLog
 * entry for the orphaned 117661 repair record (never mutates/deletes the
 * original), (2) runs read-only integrity checks against the accepted
 * 82-record baseline, (3) re-confirms production-safety state at the DB
 * level (the composite unique constraint, in particular) rather than just
 * inferring it from a prior deploy's success. Retired to a 410 stub after
 * use, same as this directory's other temporary diagnostic routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── 1. Idempotent audit annotation ──────────────────────────────────
    const existingAnnotation = await prisma.auditLog.findFirst({
      where: { action: ANNOTATE_ACTION, entityId: ORPHANED_AUDIT_ENTRY_ID },
    });

    let annotationResult: { created: boolean; auditLogId: string | null } = { created: false, auditLogId: existingAnnotation?.id ?? null };

    if (!existingAnnotation) {
      const orphanedEntry = await prisma.auditLog.findUnique({ where: { id: ORPHANED_AUDIT_ENTRY_ID } });
      if (orphanedEntry) {
        const created = await prisma.auditLog.create({
          data: {
            action: ANNOTATE_ACTION,
            entityType: "AuditLog",
            entityId: ORPHANED_AUDIT_ENTRY_ID,
            beforeJson: {
              originalAction: orphanedEntry.action,
              originalEntityType: orphanedEntry.entityType,
              originalEntityId: orphanedEntry.entityId,
              note: "The Property this entry references no longer exists in the current database.",
            },
            afterJson: {
              reason:
                "Production was reset to the 82-record seed baseline on 2026-08-08 after a destructive-seed incident " +
                "(see docs/DEPLOYMENT.md, 'The 2026-08-08 production database wipe'). The Property this entry originally " +
                "corrected (a wrong CAD subdivision match on case 117661) was deleted as part of that reset and does not " +
                "exist in the current baseline. This audit entry is retained for historical record only -- it does NOT " +
                "describe the state of any entity currently in the database. The original entry (this annotation's " +
                "entityId) was neither modified nor deleted.",
              incidentRef: "docs/DEPLOYMENT.md#the-2026-08-08-production-database-wipe--what-happened-and-what-changed",
              closureDecisionRef: "docs/DEPLOYMENT.md#incident-closure-decision-2026-08-08--closed",
              closedAt: new Date().toISOString(),
            },
          },
        });
        annotationResult = { created: true, auditLogId: created.id };
      }
    }

    // ── 2. Integrity checks on the accepted 82-record baseline ─────────
    const [
      foreclosureCaseCount,
      sourceDocumentCount,
      propertyCount,
      manualReviewTaskCount,
      appraisalPropertyCandidateCount,
      appraisalValueHistoryCount,
      auditLogCount,
      archivedCaseCount,
      processingJobCount,
      casesWithFilingNumber,
      sourceDocsMissingCase,
      manualReviewTasksOrphaned,
      ingestedBundles,
    ] = await Promise.all([
      prisma.foreclosureCase.count(),
      prisma.sourceDocument.count(),
      prisma.property.count(),
      prisma.manualReviewTask.count(),
      prisma.appraisalPropertyCandidate.count(),
      prisma.appraisalValueHistory.count(),
      prisma.auditLog.count(),
      prisma.foreclosureCase.count({ where: { archivedAt: { not: null } } }),
      prisma.processingJob.count(),
      prisma.sourceDocument.findMany({ where: { countyFilingNumber: { not: null } }, select: { countyId: true, countyFilingNumber: true, foreclosureCaseId: true } }),
      prisma.sourceDocument.count({ where: { foreclosureCaseId: null } }),
      prisma.manualReviewTask.count({ where: { sourceDocumentId: null, foreclosureCaseId: null } }),
      prisma.ingestedNoticeBundle.findMany({ select: { id: true, status: true, externalId: true, discoveredAt: true, processedAt: true } }),
    ]);

    // Duplicate detection using the same identity key the ingestion pipeline uses.
    const filingNumberGroups = new Map<string, number>();
    for (const doc of casesWithFilingNumber) {
      const normalized = normalizeCountyFilingNumber(doc.countyFilingNumber);
      if (!normalized) continue;
      const key = `${doc.countyId}::${normalized}`;
      filingNumberGroups.set(key, (filingNumberGroups.get(key) ?? 0) + 1);
    }
    const distinctFilingNumberCount = filingNumberGroups.size;
    const duplicateFilingNumberGroups = [...filingNumberGroups.entries()].filter(([, count]) => count > 1);

    // Every ForeclosureCase.propertyId that's non-null should resolve to a real Property (FK-enforced, but verify directly).
    const casesWithPropertyId = await prisma.foreclosureCase.findMany({ where: { propertyId: { not: null } }, select: { id: true, propertyId: true } });
    const propertyIds = [...new Set(casesWithPropertyId.map((c) => c.propertyId as string))];
    const existingProperties = propertyIds.length ? await prisma.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } }) : [];
    const danglingPropertyRefs = casesWithPropertyId.filter((c) => !existingProperties.some((p) => p.id === c.propertyId));

    // Every ManualReviewTask.foreclosureCaseId / sourceDocumentId that's non-null should resolve (FK-enforced, verify directly).
    const reviewTasksWithRefs = await prisma.manualReviewTask.findMany({
      select: { id: true, foreclosureCaseId: true, sourceDocumentId: true },
    });
    const caseIds = [...new Set(reviewTasksWithRefs.map((t) => t.foreclosureCaseId).filter((id): id is string => !!id))];
    const docIds = [...new Set(reviewTasksWithRefs.map((t) => t.sourceDocumentId).filter((id): id is string => !!id))];
    const [existingCasesForReview, existingDocsForReview] = await Promise.all([
      caseIds.length ? prisma.foreclosureCase.findMany({ where: { id: { in: caseIds } }, select: { id: true } }) : Promise.resolve([]),
      docIds.length ? prisma.sourceDocument.findMany({ where: { id: { in: docIds } }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const danglingReviewTaskCaseRefs = reviewTasksWithRefs.filter((t) => t.foreclosureCaseId && !existingCasesForReview.some((c) => c.id === t.foreclosureCaseId));
    const danglingReviewTaskDocRefs = reviewTasksWithRefs.filter((t) => t.sourceDocumentId && !existingDocsForReview.some((d) => d.id === t.sourceDocumentId));

    // ── 3. DB-level re-confirmation of the composite unique constraint ──
    // Prisma's `db push` implements `@@unique` as a bare CREATE UNIQUE INDEX,
    // not an ALTER TABLE ADD CONSTRAINT, so it never appears in pg_constraint.
    // Check pg_indexes (the actual enforcement mechanism) instead.
    const uniqueConstraints = await prisma.$queryRawUnsafe<{ conname: string; definition: string }[]>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'foreclosure_cases' AND c.contype = 'u'`,
    );
    const uniqueIndexes = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'foreclosure_cases'`,
    );
    const hasCountyFilingNumberConstraint =
      uniqueConstraints.some(
        (c) => c.definition.includes("county_id") && c.definition.includes("county_filing_number"),
      ) ||
      uniqueIndexes.some(
        (i) =>
          i.indexdef.toUpperCase().includes("UNIQUE") &&
          i.indexdef.includes("county_id") &&
          i.indexdef.includes("county_filing_number"),
      );

    const integrity = {
      foreclosureCaseCountIs82: foreclosureCaseCount === 82,
      sourceDocumentCountIs82: sourceDocumentCount === 82,
      distinctFilingNumberCountIs82: distinctFilingNumberCount === 82,
      noDuplicateFilingNumbers: duplicateFilingNumberGroups.length === 0,
      noDanglingPropertyRefs: danglingPropertyRefs.length === 0,
      noOrphanedSourceDocuments: sourceDocsMissingCase === 0,
      noFullyOrphanedManualReviewTasks: manualReviewTasksOrphaned === 0,
      noDanglingReviewTaskCaseRefs: danglingReviewTaskCaseRefs.length === 0,
      noDanglingReviewTaskDocRefs: danglingReviewTaskDocRefs.length === 0,
      noAppraisalCandidates: appraisalPropertyCandidateCount === 0,
      noAppraisalValueHistory: appraisalValueHistoryCount === 0,
      noArchivedCases: archivedCaseCount === 0,
      noProcessingJobs: processingJobCount === 0,
      compositeUniqueConstraintActiveAtDbLevel: hasCountyFilingNumberConstraint,
    };
    const allChecksPassed = Object.values(integrity).every(Boolean);

    return NextResponse.json({
      auditAnnotation: annotationResult,
      counts: {
        foreclosureCaseCount,
        sourceDocumentCount,
        distinctFilingNumberCount,
        propertyCount,
        manualReviewTaskCount,
        appraisalPropertyCandidateCount,
        appraisalValueHistoryCount,
        auditLogCount,
        archivedCaseCount,
        processingJobCount,
      },
      duplicateFilingNumberGroups,
      danglingPropertyRefs,
      danglingReviewTaskCaseRefs,
      danglingReviewTaskDocRefs,
      ingestedNoticeBundles: ingestedBundles,
      dbLevelUniqueConstraints: uniqueConstraints,
      dbLevelUniqueIndexes: uniqueIndexes,
      integrity,
      allChecksPassed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
