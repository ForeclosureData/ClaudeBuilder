import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma, Prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { loadFieldEvidence } from "@/lib/extracted-fields";
import { PUBLICATION_EXTRA_INCLUDE, isPubliclyVisible } from "@/lib/publicationVisibility";
import { toInvestorListing } from "@/lib/investor/adapter";
import { addressDisplayText, formatDaysUntil, formatEquity, formatMoney, formatShortDate, PROPERTY_TYPE_LABELS } from "@/lib/investor/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PropertyMetric } from "@/components/investor/ui/property-metric";
import { StatusBadge } from "@/components/investor/ui/status-badges";
import { SaveHeartButton } from "@/components/investor/save-heart-button";
import { SavedPropertiesProvider } from "@/components/investor/saved-context";
import { SourceCredibilityCard } from "@/components/investor/source-credibility-card";
import { CorrectionReportForm } from "@/components/properties/correction-report-form";
import { EstimatedBadge } from "@/components/properties/confidence-badge";
import { formatDate } from "@/lib/utils";

const EQUITY_DISCLOSURE =
  "Estimated equity is calculated using available public-record values and estimated loan information. It is not a verified payoff, appraisal, or guarantee of equity.";

const CASE_INCLUDE = {
  ...PUBLICATION_EXTRA_INCLUDE,
  county: true,
  legalDescriptions: true,
  sales: { orderBy: { saleDate: "asc" as const }, include: { trustee: { include: { person: true, organization: true } } } },
  loan: { include: { currentMortgagee: true, originalLender: true, mortgageServicer: true } },
  borrower: true,
  currentOwner: true,
  documents: { orderBy: { dateCollected: "desc" as const } },
} satisfies Prisma.ForeclosureCaseInclude;

const PROPERTY_APPRAISAL_INCLUDE = {
  appraisalValueHistory: { orderBy: { taxYear: "desc" as const }, take: 1 },
} satisfies Prisma.PropertyInclude;

type CaseWithIncludes = Prisma.ForeclosureCaseGetPayload<{ include: typeof CASE_INCLUDE }>;
type PropertyWithHistory = Prisma.PropertyGetPayload<{ include: typeof PROPERTY_APPRAISAL_INCLUDE }>;

export default async function PropertyDetailPage({ params }: { params: { id: string } }) {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);

  const propertyRow = await prisma.property.findUnique({
    where: { id: params.id },
    include: {
      ...PROPERTY_APPRAISAL_INCLUDE,
      foreclosureCases: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: CASE_INCLUDE },
    },
  });

  let fc: CaseWithIncludes;
  let property: PropertyWithHistory | null;

  if (propertyRow) {
    const firstCase = propertyRow.foreclosureCases[0];
    if (!firstCase) notFound();
    fc = firstCase;
    property = propertyRow;
  } else {
    // No Property row matched params.id -- it may instead be a
    // ForeclosureCase id. A published case can have no resolved Property
    // row at all (address-pending, published on legal-description
    // evidence alone -- see hasCoreIdentifier in publicationStatus.ts),
    // and lib/investor/adapter.ts routes those by the case's own id
    // (`id: property?.id ?? fc.id`). Without this fallback, every card
    // for such a case 404s.
    const caseRow = await prisma.foreclosureCase.findUnique({
      where: { id: params.id },
      include: { ...CASE_INCLUDE, property: { include: PROPERTY_APPRAISAL_INCLUDE } },
    });
    if (!caseRow || caseRow.archivedAt !== null) notFound();
    fc = caseRow;
    property = caseRow.property;
  }

  const county = fc.county;

  // A case whose only (or most recent) non-archived case isn't publicly
  // visible (pending an identity/conflict review, or missing a valid
  // source notice) must 404 for a public visitor exactly like a
  // nonexistent property would -- never render partial/unsafe detail.
  if (!isPubliclyVisible({ ...fc, property })) notFound();

  const unlocked = hasFullAccessToCounty(entitlement, county.slug);
  const listing = toInvestorListing({ ...fc, property }, unlocked);
  const evidence = await loadFieldEvidence(fc.id);

  const isSaved =
    profileId && property
      ? Boolean(await prisma.savedProperty.findUnique({ where: { profileId_propertyId: { profileId, propertyId: property.id } } }))
      : false;

  const daysUntilSale = formatDaysUntil(listing.saleDateISO);
  const latestDocument = fc.documents[0] ?? null;
  const canViewSource = unlocked && entitlement.canViewDocuments;

  return (
    <SavedPropertiesProvider isAuthenticated={Boolean(profileId)} initialSavedIds={isSaved && property ? [property.id] : []}>
      <div className="max-w-5xl">
        {/* Investment Snapshot */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h1
                className={
                  listing.address
                    ? "text-2xl font-semibold text-neutral-900 dark:text-neutral-50 sm:text-3xl"
                    : "text-2xl font-semibold italic text-neutral-400 dark:text-neutral-500 sm:text-3xl"
                }
              >
                {addressDisplayText(listing)}
              </h1>
              <p className="mt-1 text-neutral-500">
                {listing.city ?? listing.subdivision ?? county.name}, {listing.state} {listing.zip}
              </p>
              <div className="mt-3">
                <StatusBadge dataState={listing.dataState} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {profileId && property && <SaveHeartButton propertyId={property.id} />}
              {/* Only offered once the address is either resolved-and-unlocked or genuinely unresolved -- never for a real address hidden behind the paywall, where a "map" link would just be a confusing dead end. */}
              {(listing.address || listing.addressPending) && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address ?? `${listing.city ?? county.name} TX`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  View on map
                </a>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <PropertyMetric label="Sale Date" value={formatShortDate(listing.saleDateISO)} emphasis />
            <PropertyMetric label="Days Until Sale" value={daysUntilSale !== null ? (daysUntilSale >= 0 ? `${daysUntilSale} days` : "Past") : "Unavailable"} emphasis />
            <PropertyMetric label="Owner" value={listing.borrowerName} locked={!listing.unlocked} emphasis />
            <PropertyMetric label="Original Loan" value={formatMoney(listing.originalLoanCents)} locked={!listing.unlocked} emphasis />
            <PropertyMetric label="County Market Value" value={formatMoney(listing.countyMarketValueCents)} emphasis />
            <PropertyMetric label="County Appraised Value" value={formatMoney(listing.countyAppraisedValueCents)} emphasis />
            <PropertyMetric label="Estimated Equity" value={formatEquity(listing.estimatedEquityCents)} emphasis />
            <PropertyMetric label="Property Type" value={PROPERTY_TYPE_LABELS[listing.propertyType]} emphasis />
          </div>

          {listing.estimatedEquityCents !== null && (
            <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800">
              Based on {listing.equitySourceLabel}: {formatMoney(listing.equityBaseCents)} minus estimated remaining loan balance:{" "}
              {formatMoney(listing.equityLoanBalanceCents)}. {EQUITY_DISCLOSURE}
            </p>
          )}

          {!listing.unlocked && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-500/10">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                Unlock the address, owner, and original loan amount for this property.
              </p>
              <Link href={`/sign-up?trialCounty=${county.slug}`}>
                <Button size="sm">Start free trial</Button>
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardContent className="space-y-4">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Property Details</h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                  <PropertyMetric label="Property Type" value={PROPERTY_TYPE_LABELS[listing.propertyType]} />
                  <PropertyMetric label="Parcel ID" value={listing.parcelId ?? "Unavailable"} />
                  <PropertyMetric label="GEO ID" value={listing.geoId ?? "Unavailable"} />
                  <PropertyMetric label="Subdivision" value={listing.subdivision ?? "Unavailable"} />
                  <PropertyMetric label="Lot" value={listing.lot ?? "Unavailable"} />
                  <PropertyMetric label="Block" value={listing.block ?? "Unavailable"} />
                  <PropertyMetric label="Acreage" value={listing.acreage ? `${listing.acreage} ac` : "Unavailable"} />
                  <PropertyMetric label="Land Value" value={formatMoney(listing.landValueCents)} />
                  <PropertyMetric label="Improvement Value" value={formatMoney(listing.improvementValueCents)} />
                  <PropertyMetric label="Appraisal Year" value={listing.appraisalYear ?? "Unavailable"} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Foreclosure Details</h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                  <PropertyMetric label="Borrower" value={listing.borrowerName} locked={!listing.unlocked} />
                  <PropertyMetric label="Lender / Beneficiary" value={listing.lenderName ?? "Lender unavailable"} locked={!listing.unlocked} />
                  <PropertyMetric label="Mortgage Servicer" value={listing.mortgageServicer ?? "Unavailable"} />
                  <PropertyMetric label="Trustee" value={listing.trusteeName ?? "Unavailable"} />
                  <PropertyMetric label="Original Principal" value={formatMoney(listing.originalLoanCents)} locked={!listing.unlocked} />
                  <PropertyMetric label="Recording / Document #" value={listing.instrumentNumber ?? "Unavailable"} />
                </dl>
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Legal Description</span>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{listing.legalDescription ?? "Not available."}</p>
                </div>
              </CardContent>
            </Card>

            {fc.summaryText && (
              <Card>
                <CardContent>
                  <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">Summary</h2>
                  <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{fc.summaryText}</p>
                </CardContent>
              </Card>
            )}

            {Object.values(evidence).length > 0 && (
              <Card>
                <CardContent className="space-y-3">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Notice excerpts</h2>
                  {Object.values(evidence).map((f) => (
                    <div key={f.fieldName} className="border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{humanizeFieldName(f.fieldName)}</span>
                        {!f.explicitlyStated && <EstimatedBadge />}
                      </div>
                      {f.supportingText && (
                        <p className="mt-1 text-xs italic text-neutral-500">
                          &ldquo;{f.supportingText}&rdquo; {f.pageNumber ? `(p. ${f.pageNumber})` : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {fc.documents.length > 0 && (
              <Card>
                <CardContent className="space-y-2">
                  <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">Documents</h2>
                  {fc.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-md border border-neutral-100 p-3 text-sm dark:border-neutral-800">
                      <div>
                        <p className="font-medium text-neutral-900 dark:text-neutral-50">{doc.documentType.replace(/_/g, " ")}</p>
                        <p className="text-xs text-neutral-500">filed {formatDate(doc.filingDate?.toISOString() ?? null)}</p>
                      </div>
                      {canViewSource ? (
                        <Link href={doc.documentUrl} target="_blank" className="text-brand-600 underline dark:text-brand-400">View original</Link>
                      ) : (
                        <Link href="/pricing" className="text-brand-600 underline dark:text-brand-400">Upgrade to view</Link>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <SourceCredibilityCard
              listing={listing}
              countyName={county.name}
              sourceUrl={latestDocument?.documentUrl ?? null}
              canViewSource={canViewSource}
            />

            <Card>
              <CardContent className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Verification</h2>
                <p>Last verified: {formatDate(fc.lastVerifiedAt?.toISOString() ?? null)}</p>
                <CorrectionReportForm propertyId={property?.id} foreclosureCaseId={fc.id} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SavedPropertiesProvider>
  );
}

function humanizeFieldName(fieldName: string): string {
  return fieldName.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
