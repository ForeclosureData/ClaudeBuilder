import Link from "next/link";
import { ShieldCheck, Landmark, FileCheck2, RadarIcon } from "lucide-react";
import { prisma } from "@foreclosuredata/database";
import { Button } from "@/components/ui/button";
import { CountySearch } from "@/components/search/county-search";
import { WorkflowSteps } from "@/components/marketing/workflow-steps";
import { getPublicForeclosureCases } from "@/lib/properties";

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: "Source-backed data", description: "Every record traces back to the original county foreclosure notice." },
  { icon: Landmark, label: "County appraisal values", description: "Market and appraised values pulled from the county record, where available." },
  { icon: FileCheck2, label: "Original notice included", description: "View the source document behind every listing." },
  { icon: RadarIcon, label: "Built for ongoing county monitoring", description: "Designed to track new filings as counties publish them." },
];

// Rendered per-request rather than at build time -- the proof-point counts
// below are live Prisma queries, and this page has no dynamic route
// segments, so Next would otherwise try to prerender it (and hit the
// database) during `next build` itself. force-dynamic keeps a database
// outage during a deploy from ever failing the build; the two aggregate
// queries are cheap at the current bundle's scale.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [sourceNoticesProcessed, { totalCount: investorReadyListings }] = await Promise.all([
    prisma.foreclosureCase.count({ where: { archivedAt: null } }),
    getPublicForeclosureCases({}),
  ]);

  return (
    <div>
      <section className="border-b border-neutral-200 bg-gradient-to-b from-brand-50/60 to-white dark:border-neutral-800 dark:from-neutral-950 dark:to-neutral-950">
        <div className="container-page flex flex-col items-center gap-6 py-16 text-center sm:py-24">
          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800">Now in Hidalgo County, TX</span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-5xl">
            Find Foreclosures in Seconds, Not Hours.
          </h1>
          <p className="text-base font-medium text-neutral-500 dark:text-neutral-400">Stop reading hundreds of pages of foreclosure PDFs.</p>
          <p className="max-w-xl text-base text-neutral-600 dark:text-neutral-300">
            ForeclosureData turns county foreclosure notices into searchable investment opportunities with property addresses, sale
            dates, owners, loan amounts, county values, and original source documents.
          </p>

          <div className="mt-2 w-full max-w-xl">
            <CountySearch autoFocus size="lg" />
            <p className="mt-3 text-sm text-neutral-400">
              Try{" "}
              <Link href="/county/hidalgo-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Hidalgo County</Link>,{" "}
              <Link href="/county/dallas-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Dallas County</Link>, or{" "}
              <Link href="/county/bexar-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Bexar County</Link>
            </p>
          </div>

          <p className="mt-2 text-xs uppercase tracking-wide text-neutral-400">No account needed to browse</p>

          <Link href="#how-it-works" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
            See How It Works
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="border-b border-neutral-200 py-16 dark:border-neutral-800">
        <div className="container-page">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">From county PDF to searchable listing</h2>
            <p className="mt-2 text-sm text-neutral-500">Four steps, no manual reading required.</p>
          </div>
          <WorkflowSteps />
        </div>
      </section>

      <section className="py-10">
        <div className="container-page">
          <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            <span className="font-semibold text-neutral-900 dark:text-neutral-50">{investorReadyListings} investor-ready listings</span> from{" "}
            {sourceNoticesProcessed} county notices processed &middot; original county sources retained &middot; county appraisal
            enrichment where available
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container-page">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <div key={item.label} className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                <item.icon className="h-5 w-5 text-brand-700" />
                <div className="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">{item.label}</div>
                <p className="mt-1 text-sm text-neutral-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-200 bg-brand-900 py-16 dark:border-neutral-800">
        <div className="container-page flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold text-white">See what&rsquo;s coming up for sale in Hidalgo County</h2>
          <p className="max-w-md text-sm text-brand-100">
            Browse active foreclosures with property addresses, sale dates, county values, and estimated equity.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/county/hidalgo-tx">
              <Button size="lg" variant="secondary">Browse Foreclosures</Button>
            </Link>
            <Link href="/sign-up?trialCounty=hidalgo-tx">
              <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10">
                Start Free Trial
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
