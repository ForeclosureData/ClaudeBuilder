import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDemoCaseById, DEMO_HIDALGO_CASES } from "@/lib/demo/fixtures/hidalgo-demo-cases";
import { Card, CardContent } from "@/components/ui/card";
import { PropertyMetric } from "@/components/demo/ui/property-metric";
import { StatusBadges } from "@/components/demo/ui/status-badges";
import { SaveHeartButton } from "@/components/demo/save-heart-button";
import { SourceCredibilityCard } from "@/components/demo/source-credibility-card";
import { formatDaysUntil, formatEquity, formatMoney, formatShortDate, PROPERTY_TYPE_LABELS } from "@/lib/demo/format";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const demoCase = getDemoCaseById(params.id);
  return { title: demoCase ? `${demoCase.address ?? demoCase.city} — ForeclosureData Demo` : "Property not found" };
}

export default function DemoPropertyPage({ params }: { params: { id: string } }) {
  const demoCase = getDemoCaseById(params.id);
  if (!demoCase) notFound();

  const daysUntilSale = formatDaysUntil(demoCase.saleDateISO);

  return (
    <div className="container-page py-6 sm:py-8">
      <Link href="/demo/browse" className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to results
      </Link>

      {/* Investment Snapshot */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">{demoCase.address ?? "Address pending review"}</h1>
            <p className="mt-1 text-neutral-500">
              {demoCase.city}, {demoCase.state} {demoCase.zip}
            </p>
            <StatusBadges statuses={demoCase.dataStatuses} className="mt-3 flex flex-wrap gap-1.5" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SaveHeartButton caseId={demoCase.id} />
            <Link href={`/demo/source/${demoCase.id}`} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              View Original Notice
            </Link>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <PropertyMetric label="Sale Date" value={formatShortDate(demoCase.saleDateISO)} emphasis />
          <PropertyMetric label="Days Until Sale" value={daysUntilSale >= 0 ? `${daysUntilSale} days` : "Past"} emphasis />
          <PropertyMetric label="Owner" value={demoCase.borrowerName} emphasis />
          <PropertyMetric label="Original Loan" value={formatMoney(demoCase.originalLoanCents)} emphasis />
          <PropertyMetric label="County Market Value" value={formatMoney(demoCase.countyMarketValueCents)} emphasis />
          <PropertyMetric label="County Appraised Value" value={formatMoney(demoCase.countyAppraisedValueCents)} emphasis />
          <PropertyMetric label="Estimated Equity" value={formatEquity(demoCase.estimatedEquityCents)} emphasis />
          <PropertyMetric label="Property Type" value={PROPERTY_TYPE_LABELS[demoCase.propertyType]} emphasis />
        </div>

        {demoCase.estimatedEquityCents !== null && (
          <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            Estimated equity is based on County Market Value minus an estimated remaining loan balance. This is an estimate, not a guaranteed
            amount, auction profit, or verified payoff.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Property */}
          <Card>
            <CardContent className="space-y-4">
              <h2 className="text-sm font-semibold text-neutral-900">Property</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                <PropertyMetric label="Property Type" value={PROPERTY_TYPE_LABELS[demoCase.propertyType]} />
                <PropertyMetric label="Parcel ID" value={demoCase.parcelId ?? "Unavailable"} />
                <PropertyMetric label="GEO ID" value={demoCase.geoId ?? "Unavailable"} />
                <PropertyMetric label="Subdivision" value={demoCase.subdivision ?? "Unavailable"} />
                <PropertyMetric label="Lot" value={demoCase.lot ?? "—"} />
                <PropertyMetric label="Block" value={demoCase.block ?? "—"} />
                <PropertyMetric label="Acreage" value={demoCase.acreage ? `${demoCase.acreage} ac` : "—"} />
                <PropertyMetric label="Land Value" value={formatMoney(demoCase.landValueCents)} />
                <PropertyMetric label="Improvement Value" value={formatMoney(demoCase.improvementValueCents)} />
                <PropertyMetric label="Appraisal Year" value={demoCase.appraisalYear ?? "Unavailable"} />
              </dl>
            </CardContent>
          </Card>

          {/* Foreclosure details -- secondary, lender not visually prioritized */}
          <Card>
            <CardContent className="space-y-4">
              <h2 className="text-sm font-semibold text-neutral-900">Foreclosure Details</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                <PropertyMetric label="Borrower" value={demoCase.borrowerName} />
                <PropertyMetric label="Lender / Beneficiary" value={demoCase.lenderName} />
                <PropertyMetric label="Mortgage Servicer" value={demoCase.mortgageServicer ?? "Unavailable"} />
                <PropertyMetric label="Trustee" value={demoCase.trusteeName} />
                <PropertyMetric label="Original Principal" value={formatMoney(demoCase.originalLoanCents)} />
                <PropertyMetric label="Recording / Document #" value={demoCase.instrumentNumber ?? "Unavailable"} />
              </dl>
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Legal Description</span>
                <p className="mt-1 text-sm leading-relaxed text-neutral-600">{demoCase.legalDescription}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <SourceCredibilityCard demoCase={demoCase} />
        </div>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return DEMO_HIDALGO_CASES.map((c) => ({ id: c.id }));
}
