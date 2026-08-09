import { NextResponse } from "next/server";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { loadFieldEvidence } from "@/lib/extracted-fields";
import { PUBLICATION_EXTRA_INCLUDE, isPubliclyVisible } from "@/lib/publicationVisibility";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);

  const property = await prisma.property.findUnique({
    where: { id: params.id },
    include: {
      county: true,
      foreclosureCases: {
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          ...PUBLICATION_EXTRA_INCLUDE,
          sales: { orderBy: { saleDate: "asc" } },
          loan: { include: { currentMortgagee: true, originalLender: true } },
          borrower: true,
          documents: true,
        },
      },
    },
  });
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fc = property.foreclosureCases[0];
  if (!fc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // See lib/publicationVisibility.ts -- a case that isn't publicly visible
  // must 404 exactly like a nonexistent property, never leak partial data.
  if (!isPubliclyVisible({ ...fc, property })) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const unlocked = hasFullAccessToCounty(entitlement, property.county.slug);
  const sale = fc.sales[fc.sales.length - 1];
  const evidence = await loadFieldEvidence(fc.id);
  const isSaved = profileId
    ? Boolean(await prisma.savedProperty.findUnique({ where: { profileId_propertyId: { profileId, propertyId: property.id } } }))
    : false;

  const field = (name: string, fallback: string | number | null = null) => {
    const e = evidence[name];
    return {
      value: unlocked ? (e?.value ?? fallback) : null,
      sourceType: e?.sourceType.toLowerCase() ?? null,
      confidence: e?.confidence ?? null,
      explicitlyStated: e?.explicitlyStated ?? false,
      supportingText: e?.supportingText ?? null,
      pageNumber: e?.pageNumber ?? null,
    };
  };

  return NextResponse.json({
    id: property.id,
    countySlug: property.county.slug,
    countyName: property.county.name,
    propertyStreetAddress: unlocked ? property.propertyStreetAddress : null,
    city: property.city,
    zipCode: unlocked ? property.zipCode : null,
    latitude: property.latitude,
    longitude: property.longitude,
    propertyType: property.propertyType,
    classification: property.classification,
    appraisedValueCents: property.appraisedValueCents,
    addressResolutionMethod: property.addressResolutionMethod,
    addressResolutionConfidence: property.addressResolutionConfidence,
    addressResolutionExplanation: property.addressResolutionExplanation,
    isSaved,
    lastVerifiedAt: fc.lastVerifiedAt?.toISOString() ?? null,
    summaryText: unlocked ? fc.summaryText : null,
    saleDate: sale?.saleDate?.toISOString() ?? null,
    saleTime: sale?.saleTime ?? null,
    saleLocation: sale?.saleLocation ?? null,
    saleStatus: fc.status,
    borrowerName: field("borrowerName"),
    lenderName: field("lenderName"),
    originalPrincipalAmountCents: field("originalPrincipalAmount", fc.loan?.originalPrincipalAmountCents ?? null),
    currentPrincipalBalanceCents: field("currentPrincipalBalance", fc.loan?.currentPrincipalBalanceCents ?? null),
    estimatedRemainingBalanceCents: fc.loan?.estimatedRemainingBalanceCents
      ? {
          value: unlocked ? fc.loan.estimatedRemainingBalanceCents : null,
          methodology: fc.loan.remainingBalanceMethodology,
          confidence: fc.loan.remainingBalanceConfidence,
          disclaimer: "Estimate only, not a payoff statement.",
        }
      : null,
    documents: fc.documents.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      documentType: doc.documentType,
      filingDate: doc.filingDate?.toISOString() ?? null,
      manualReviewStatus: doc.manualReviewStatus,
      documentUrl: unlocked && entitlement.canViewDocuments ? doc.documentUrl : "",
      canView: unlocked && entitlement.canViewDocuments,
    })),
    canViewDocuments: unlocked && entitlement.canViewDocuments,
  });
}
