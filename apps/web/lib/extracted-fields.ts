import { prisma } from "@foreclosuredata/database";

export interface FieldEvidence {
  fieldName: string;
  value: string | null;
  sourceType: string;
  confidence: number | null;
  explicitlyStated: boolean;
  supportingText: string | null;
  pageNumber: number | null;
  verifiedAt: Date | null;
}

/** Loads field-level provenance for a ForeclosureCase, keyed by fieldName (latest row per field). */
export async function loadFieldEvidence(foreclosureCaseId: string): Promise<Record<string, FieldEvidence>> {
  const rows = await prisma.extractedField.findMany({
    where: { entityType: "ForeclosureCase", entityId: foreclosureCaseId },
    orderBy: { createdAt: "desc" },
  });
  const byField: Record<string, FieldEvidence> = {};
  for (const row of rows) {
    if (byField[row.fieldName]) continue; // keep only the most recent row per field
    byField[row.fieldName] = {
      fieldName: row.fieldName,
      value: row.value,
      sourceType: row.sourceType,
      confidence: row.confidence,
      explicitlyStated: row.explicitlyStated,
      supportingText: row.supportingText,
      pageNumber: row.pageNumber,
      verifiedAt: row.verifiedAt,
    };
  }
  return byField;
}
