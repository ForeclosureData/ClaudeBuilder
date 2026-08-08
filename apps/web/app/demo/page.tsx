import Link from "next/link";
import { ShieldCheck, Landmark, FileCheck2, RadarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountySearchHero } from "@/components/demo/county-search-hero";
import { WorkflowSteps } from "@/components/demo/workflow-steps";

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: "Source-backed data", description: "Every record traces back to the original county notice." },
  { icon: Landmark, label: "County appraisal values", description: "Market and appraised values pulled from the county record." },
  { icon: FileCheck2, label: "Original notice included", description: "View the source document behind every listing." },
  { icon: RadarIcon, label: "Built for automated county monitoring", description: "Designed to track new filings as counties publish them." },
];

export default function DemoLandingPage() {
  return (
    <div>
      <section className="border-b border-neutral-200 bg-gradient-to-b from-brand-50/60 to-white">
        <div className="container-page flex flex-col items-center gap-6 py-16 text-center sm:py-24">
          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800">Now in Hidalgo County, TX</span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
            Find Foreclosures in Seconds, Not Hours.
          </h1>
          <p className="text-base font-medium text-neutral-500">Stop reading 700-page county foreclosure PDFs.</p>
          <p className="max-w-xl text-base text-neutral-600">
            ForeclosureData turns county foreclosure notices into searchable investment opportunities with property addresses,
            sale dates, owners, loan amounts, county values, and original source documents.
          </p>

          <div className="mt-2 w-full max-w-xl">
            <CountySearchHero />
          </div>

          <Link href="#how-it-works" className="text-sm font-medium text-brand-700 hover:underline">
            See How It Works
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="border-b border-neutral-200 py-16">
        <div className="container-page">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-neutral-900">From county PDF to searchable listing</h2>
            <p className="mt-2 text-sm text-neutral-500">Four steps, no manual reading required.</p>
          </div>
          <WorkflowSteps />
        </div>
      </section>

      <section className="py-16">
        <div className="container-page">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <div key={item.label} className="rounded-lg border border-neutral-200 bg-white p-5">
                <item.icon className="h-5 w-5 text-brand-700" />
                <div className="mt-3 text-sm font-semibold text-neutral-900">{item.label}</div>
                <p className="mt-1 text-sm text-neutral-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-200 bg-brand-900 py-16">
        <div className="container-page flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold text-white">See what's coming up for sale in Hidalgo County</h2>
          <p className="max-w-md text-sm text-brand-100">Browse active foreclosures with property addresses, sale dates, county values, and estimated equity.</p>
          <Link href="/demo/browse">
            <Button size="lg" variant="secondary">Browse Foreclosures</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
