import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty, type PropertyValuationResult } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { loadFieldEvidence } from "@/lib/extracted-fields";
import { getAllValuations } from "@/lib/valuation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, EstimatedBadge } from "@/components/properties/confidence-badge";
import { SaveButton } from "@/components/properties/save-button";
import { CorrectionReportForm } from "@/components/properties/correction-report-form";
import { formatCurrencyCents, formatDate, daysUntil, formatBorrowerName } from "@/lib/utils";
import { saleStatusLabels, addressResolutionMethodLabels, fieldSourceLabels } from "@foreclosuredata/config";

const COUNTY_VALUES_DISCLOSURE =
  "County appraisal values are used for property-tax purposes and may differ from the property's current resale value.";
const EQUITY_DISCLOSURE =
  "Estimated equity is calculated using available public-record values and estimated loan information. It is not a verified payoff, appraisal, or guarantee of equity.";

export default async function PropertyDetailPage({ params }: { params: { id: string } }) {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);

  const property = await prisma.property.findUnique({
    where: { id: params.id },
    include: {
      county: true,
      appraisalValueHistory: { orderBy: { taxYear: "desc" }, take: 1 },
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

  const valuations = await getAllValuations({
    propertyId: property.id,
    streetAddress: property.propertyStreetAddress ?? undefined,
    city: property.city ?? undefined,
    state: property.state,
    postalCode: property.zipCode ?? undefined,
    county: property.county.name,
    parcelId: property.propertyIdNumber ?? undefined,
  });
  const displayableValuations = valuations.filter((v) => v.licenseAllowsDisplay && (!v.expiresAt || new Date(v.expiresAt) > new Date()));
  const marketValuation = displayableValuations.find((v) => v.valuationType === "county_market_value") ?? null;
  const appraisedValuation = displayableValuations.find((v) => v.valuationType === "county_appraised_value") ?? null;
  const latestAppraisal = property.appraisalValueHistory[0] ?? null;

  // Equity prefers County Market Value over County Appraised Value (per the
  // county's own more-current field, when it names one) and never silently
  // falls back to a fabricated internal estimate -- if the county has no
  // value, no equity figure is computed at all.
  const equitySource = marketValuation ?? appraisedValuation ?? null;
  const equitySourceLabel = equitySource === marketValuation ? "County Market Value" : "County Appraised Value";
  const equityBaseCents = equitySource ? Math.round(equitySource.value * 100) : null;
  const loanBalanceCents = fc.loan?.currentPrincipalBalanceCents ?? fc.loan?.estimatedRemainingBalanceCents ?? null;
  const equityCents = equityBaseCents !== null && loanBalanceCents !== null ? equityBaseCents - loanBalanceCents : null;

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
              <Field label="Borrower" value={unlocked ? formatBorrowerName(fc.borrower?.fullName) : "Upgrade to view"} />
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
              <Field label="Property type" value={property.propertyType} />
              <Field label="Address confidence"><ConfidenceBadge confidence={property.addressResolutionConfidence} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Property values</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {marketValuation && <CountyValueBlock label="County Market Value" valuation={marketValuation} countyName={property.county.name} />}
              {appraisedValuation && (
                <CountyValueBlock label="County Appraised Value" valuation={appraisedValuation} countyName={property.county.name} />
              )}
              {!marketValuation && !appraisedValuation && (
                <p className="text-sm text-neutral-500">County value unavailable.</p>
              )}

              {latestAppraisal && (latestAppraisal.landValueCents !== null || latestAppraisal.improvementValueCents !== null) && (
                <div className="grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4 text-sm dark:border-neutral-800">
                  {latestAppraisal.landValueCents !== null && <Field label="Land Value" value={formatCurrencyCents(latestAppraisal.landValueCents)} />}
                  {latestAppraisal.improvementValueCents !== null && (
                    <Field label="Improvement Value" value={formatCurrencyCents(latestAppraisal.improvementValueCents)} />
                  )}
                  <Field label="Last Retrieved" value={formatDate(latestAppraisal.retrievedAt.toISOString())} />
                </div>
              )}

              {(marketValuation || appraisedValuation) && <p className="text-xs text-neutral-500">{COUNTY_VALUES_DISCLOSURE}</p>}

              <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
                <p className="text-xs uppercase tracking-wide text-neutral-400">Estimated Equity</p>
                {equityCents !== null ? (
                  <>
                    <p className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                      {formatCurrencyCents(equityCents)} <EstimatedBadge />
                    </p>
                    <p className="mt-2 text-xs text-neutral-500">
                      Based on:
                      <br />
                      {equitySourceLabel}: {formatCurrencyCents(equityBaseCents)}
                      <br />
                      Estimated Remaining Loan Balance: {formatCurrencyCents(loanBalanceCents)}
                    </p>
                    <p className="mt-2 text-xs text-neutral-500">{EQUITY_DISCLOSURE}</p>
                  </>
                ) : (
                  <p className="mt-0.5 text-neutral-900 dark:text-neutral-50">Estimated Equity unavailable</p>
                )}
              </div>
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

/**
 * County Market Value and County Appraised Value are official-record
 * fields, not estimates -- shown under whichever exact label the county
 * record names, never blended together or relabeled (e.g. never
 * "Zestimate", "current market price", "fair market value", or
 * "guaranteed value").
 */
function CountyValueBlock({ label, valuation, countyName }: { label: string; valuation: PropertyValuationResult; countyName: string }) {
  const taxYear = valuation.effectiveDate ? valuation.effectiveDate.slice(0, 4) : null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{formatCurrencyCents(Math.round(valuation.value * 100))}</p>
      <p className="text-xs text-neutral-500">
        {valuation.attributionText ?? `${countyName} County Appraisal District`}
        {taxYear ? ` · ${taxYear}` : ""}
      </p>
    </div>
  );
}
