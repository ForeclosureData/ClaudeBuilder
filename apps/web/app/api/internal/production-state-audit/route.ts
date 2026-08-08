import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { normalizeCountyFilingNumber } from "@foreclosuredata/foreclosure-core";

export const maxDuration = 60;

/**
 * Read-only production-state audit for the post-wipe-incident safety review.
 * Makes NO writes. Reports the exact counts/checks requested so the current
 * state can be classified (A: restored pre-wipe / B: still at 82-seed
 * baseline / C: partial-inconsistent / D: something else) without guessing.
 * Retired to a 410 stub after use, same as this directory's other temporary
 * diagnostic routes.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [
      foreclosureCaseCount,
      sourceDocumentCount,
      propertyCount,
      manualReviewTaskCount,
      appraisalPropertyCandidateCount,
      appraisalValueHistoryCount,
      auditLogCount,
      archivedCaseCount,
      casesWithFilingNumber,
    ] = await Promise.all([
      prisma.foreclosureCase.count(),
      prisma.sourceDocument.count(),
      prisma.property.count(),
      prisma.manualReviewTask.count(),
      prisma.appraisalPropertyCandidate.count(),
      prisma.appraisalValueHistory.count(),
      prisma.auditLog.count(),
      prisma.foreclosureCase.count({ where: { archivedAt: { not: null } } }),
      prisma.sourceDocument.findMany({
        where: { countyFilingNumber: { not: null } },
        select: { countyId: true, countyFilingNumber: true },
      }),
    ]);

    // Duplicate detection: group by (countyId, normalized filing number), same identity key processSingleNotice now uses.
    const groups = new Map<string, number>();
    for (const doc of casesWithFilingNumber) {
      const normalized = normalizeCountyFilingNumber(doc.countyFilingNumber);
      if (!normalized) continue;
      const key = `${doc.countyId}::${normalized}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const distinctFilingNumberCount = groups.size;
    const duplicateGroups = [...groups.entries()].filter(([, count]) => count > 1);
    const duplicateFilingNumbers = duplicateGroups.map(([key, count]) => ({ key, rowCount: count }));

    // 117661 repair/audit history check.
    const repairAuditLogs = await prisma.auditLog.findMany({
      where: { action: "CORRECT_WRONG_CAD_ENRICHMENT" },
      select: { id: true, entityType: true, entityId: true, createdAt: true, beforeJson: true, afterJson: true },
    });
    const repairAuditEntityIds = repairAuditLogs.map((log) => log.entityId);
    const stillExistingProperties = repairAuditEntityIds.length
      ? await prisma.property.findMany({ where: { id: { in: repairAuditEntityIds } }, select: { id: true, subdivision: true } })
      : [];
    const orphanedRepairAuditLogs = repairAuditLogs.filter((log) => !stillExistingProperties.some((p) => p.id === log.entityId));

    // Look specifically for a case whose caseNumber references 117661, regardless of whether the audit log's target Property still exists.
    const case117661 = await prisma.foreclosureCase.findFirst({
      where: { OR: [{ caseNumber: { contains: "117661" } }, { countyFilingNumber: "117661" }] },
      select: { id: true, caseNumber: true, countyFilingNumber: true, propertyId: true, archivedAt: true },
    });

    // Classification.
    let classification: "A" | "B" | "C" | "D";
    let classificationLabel: string;
    if (foreclosureCaseCount === 82 && sourceDocumentCount === 82 && distinctFilingNumberCount === 82 && duplicateGroups.length === 0) {
      classification = "B";
      classificationLabel = "Still at the 82-record seed baseline (post-wipe state, not restored)";
    } else if (foreclosureCaseCount >= 160 && duplicateGroups.length > 0 && repairAuditLogs.length > 0) {
      classification = "A";
      classificationLabel = "Appears restored to (or consistent with) the pre-wipe state";
    } else if (foreclosureCaseCount > 82 && foreclosureCaseCount < 160) {
      classification = "C";
      classificationLabel = "Partially restored / inconsistent -- more than the seed baseline but not matching the pre-wipe row counts";
    } else {
      classification = "D";
      classificationLabel = "Does not match any expected pattern -- needs manual review of the raw counts below";
    }

    return NextResponse.json({
      counts: {
        foreclosureCaseCount,
        distinctHidalgoFilingNumberCount: distinctFilingNumberCount,
        sourceDocumentCount,
        propertyCount,
        manualReviewTaskCount,
        appraisalPropertyCandidateCount,
        appraisalValueHistoryCount,
        auditLogCount,
        archivedCaseCount,
      },
      duplicates: {
        duplicateFilingNumberGroupCount: duplicateGroups.length,
        duplicateFilingNumbers,
      },
      repair117661: {
        auditLogEntriesFound: repairAuditLogs.length,
        auditLogEntries: repairAuditLogs,
        orphanedAuditLogEntries: orphanedRepairAuditLogs.length,
        caseFoundByFilingNumberOrCaseNumber: case117661,
      },
      classification,
      classificationLabel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 },
    );
  }
}
