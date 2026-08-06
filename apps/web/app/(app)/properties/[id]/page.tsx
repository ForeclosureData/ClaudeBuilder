import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { loadFieldEvidence } from "@/lib/extracted-fields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, EstimatedBadge } from "@/components/properties/confidence-badge";
import { SaveButton } from "@/components/properties/save-button";
import { CorrectionReportForm } from "@/components/properties/correction-report-form";
import { formatCurrencyCents, formatDate, daysUntil } from "@/lib/utils";
import { saleStatusLabels, addressResolutionMethodLabels, fieldSourceLabels } from "@foreclosuredata/config";

export default async function PropertyDetailPage({ params }: { params: { id: string } }) {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);

  const property = await prisma.property.findUnique({
    where: { id: params.id },
    include: {
      county: true,
      foreclosureCases: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sales: { orderBy: { saleDate: "asc" }, include: { trustee: { include: { person: true, organization: true } } } },
          loan: { include: { currentMortgagee: true, originalLender: true, mortgageServicer: true } },
          borrower: true,
          currentOwner: true,
          documents: { orderBy: { dateCollected: "desc" } },
        },
      },
    },
  });

  if (!property) notFound();

  const fc = property.foreclosureCases[0];
  if (!fc) notFound();

  const unlocked = hasFullAccessToCounty(entitlement, property.county.slug);
  const sale = fc.sales[fc.sales.length - 1];
  const evidence = await loadFieldEvidence(fc.id);

  const isSaved = profileId
    ? Boolean(await prisma.savedProperty.findUnique({ where: { profileId_propertyId: { profileId, propertyId: property.id } } }))
    : false;

  const days = daysUntil(sale?.saleDate?.toISOString() ?? null);
  const equityCents =
    property.appraisedValueCents !== null && fc.loan
      ? property.appraisedValueCents - (fc.loan.currentPrincipalBalanceCents ?? fc.loan.estimatedRemainingBalanceCents ?? 0)
      : null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            {property.propertyStreetAddress ?? `Address pending review — ${property.subdivision ?? property.city ?? property.county.name}`}
          </h1>
          <p className="text-neutral-500">{property.city}, TX {property.zipCode} &middot; {property.county.name} County</p>
        </div>
        <div className="flex items-center gap-2">
          {profileId && <SaveButton propertyId={property.id} initiallySaved={isSaved} />}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.propertyStreetAddress ?? `${property.city ?? ""} TX`)}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand-600 underline dark:text-brand-400"
          >
            View on map
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Sale date" value={formatDate(sale?.saleDate?.toISOString() ?? null)} extra={days !== null && days >= 0 ? `${days} day${days === 1 ? "" : "s"} away` : undefined} />
              <Field label="Sale status"><Badge tone={fc.status === "CANCELED" ? "danger" : "success"}>{saleStatusLabels[fc.status]}</Badge></Field>
              <Field label="Borrower" value={unlocked ? fc.borrower?.fullName ?? "Unknown" : "Upgrade to view"} />
              <Field label="Current owner" value={unlocked ? fc.currentOwner?.fullName ?? "Unknown" : "Upgrade to view"} />
              <Field label="Lender" value={unlocked ? fc.loan?.currentMortgagee?.name ?? fc.loan?.originalLender?.name ?? "Unknown" : "Upgrade to view"} />
              <Field label="Original principal" value={formatCurrencyCents(fc.loan?.originalPrincipalAmountCents ?? null)} />
              <Field label="Current balance">
                {fc.loan?.currentPrincipalBalanceCents !== null && fc.loan?.currentPrincipalBalanceCents !== undefined ? (
                  formatCurrencyCents(fc.loan.currentPrincipalBalanceCents)
                ) : fc.loan?.estimatedRemainingBalanceCents ? (
                  <span>
                    {formatCurrencyCents(fc.loan.estimatedRemainingBalanceCents)} <EstimatedBadge />
                  </span>
                ) : (
                  "Not stated in foreclosure notice"
                )}
              </Field>
              <Field label="Appraised value" value={formatCurrencyCents(property.appraisedValueCents)} />
              <Field label="Estimated equity">
                {equityCents !== null ? (
                  <span>{formatCurrencyCents(equityCents)} <EstimatedBadge /></span>
                ) : (
                  "Unknown"
                )}
              </Field>
              <Field label="Property type" value={property.propertyType} />
              <Field label="Address confidence"><ConfidenceBadge confidence={property.addressResolutionConfidence} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Plain-English summary</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                {fc.summaryText ?? "Summary not yet generated for this record."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Source evidence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {Object.values(evidence).length === 0 && <p className="text-sm text-neutral-500">No field-level evidence recorded yet.</p>}
              {Object.values(evidence).map((f) => (
                <div key={f.fieldName} className="border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{humanizeFieldName(f.fieldName)}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone="brand">{fieldSourceLabels[f.sourceType.toUpperCase()] ?? f.sourceType}</Badge>
                      <ConfidenceBadge confidence={f.confidence} />
                      {!f.explicitlyStated && <EstimatedBadge />}
                    </div>
                  </div>
                  {f.supportingText && <p className="mt-1 text-xs italic text-neutral-500">&ldquo;{f.supportingText}&rdquo; {f.pageNumber ? `(p. ${f.pageNumber})` : ""}</p>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {fc.documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between rounded-md border border-neutral-100 p-3 text-sm dark:border-neutral-800">
                  <div>
                    <p className="font-medium text-neutral-900 dark:text-neutral-50">{doc.filename}</p>
                    <p className="text-xs text-neutral-500">{doc.documentType} &middot; filed {formatDate(doc.filingDate?.toISOString() ?? null)} &middot; {doc.status}</p>
                  </div>
                  {unlocked && entitlement.canViewDocuments ? (
                    <Link href={doc.documentUrl} target="_blank" className="text-brand-600 underline dark:text-brand-400">View original</Link>
                  ) : (
                    <Link href="/pricing" className="text-brand-600 underline dark:text-brand-400">Upgrade to view</Link>
                  )}
                </div>
              ))}
              {fc.documents.length === 0 && <p className="text-sm text-neutral-500">No documents on file yet.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Address resolution</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="font-medium">Method:</span> {addressResolutionMethodLabels[property.addressResolutionMethod] ?? property.addressResolutionMethod}</p>
              <p><span className="font-medium">Confidence:</span> <ConfidenceBadge confidence={property.addressResolutionConfidence} /></p>
              {property.addressResolutionExplanation && <p className="text-neutral-500">{property.addressResolutionExplanation}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Verification</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
              <p>Last verified: {formatDate(fc.lastVerifiedAt?.toISOString() ?? null)}</p>
              <CorrectionReportForm propertyId={property.id} foreclosureCaseId={fc.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, extra, children }: { label: string; value?: string; extra?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <div className="mt-0.5 text-neutral-900 dark:text-neutral-50">{children ?? value}</div>
      {extra && <p className="text-xs text-neutral-500">{extra}</p>}
    </div>
  );
}

function humanizeFieldName(fieldName: string): string {
  return fieldName.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
