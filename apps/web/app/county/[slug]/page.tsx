import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@foreclosuredata/database";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getPublicForeclosureCases } from "@/lib/properties";
import { toInvestorListing } from "@/lib/investor/adapter";
import type { InvestorCountySummary } from "@/lib/investor/types";
import { BrowseView } from "@/components/investor/browse-view";
import { SavedPropertiesProvider } from "@/components/investor/saved-context";
import { EmptyState } from "@/components/properties/empty-state";
import { RequestCountyForm } from "@/components/search/request-county-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const revalidate = 60;

/**
 * A free/signed-out visitor can browse a bounded free sample of this
 * county's investor-ready listings before the "unlock every foreclosure"
 * paywall kicks in -- mirrors the entitlement gating this page already
 * applied before productization (see git history), just applied to the new
 * investor UI instead of a locked-cell table. Every field on every listing
 * (locked or not) still passes through toInvestorListing()'s own
 * `unlocked` gating, so even the free sample never leaks borrower/lender/
 * principal to a signed-out visitor.
 */
const FREE_SAMPLE_SIZE = 12;

export default async function CountyPage({ params, searchParams }: { params: { slug: string }; searchParams: { view?: string } }) {
  const county = await prisma.county.findUnique({ where: { slug: params.slug } });
  if (!county) notFound();

  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);
  const unlocked = hasFullAccessToCounty(entitlement, county.slug);

  if (!county.isActive) {
    return (
      <div className="container-page py-10">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{county.name} County</h1>
        <div className="mt-8 space-y-6">
          <EmptyState
            message={`${county.name} County is coming soon.`}
            hint="We're prioritizing counties by user demand, foreclosure volume, and technical feasibility."
          />
          <Card className="mx-auto max-w-md p-4">
            <p className="mb-3 text-center text-sm text-neutral-500">Want us to prioritize {county.name} County?</p>
            <RequestCountyForm prefill={`${county.name} County`} />
          </Card>
        </div>
      </div>
    );
  }

  const { cases } = await getPublicForeclosureCases({ countySlug: county.slug });
  const visibleCases = unlocked ? cases : cases.slice(0, FREE_SAMPLE_SIZE);
  const listings = visibleCases.map((fc) => toInvestorListing(fc, unlocked));

  const now = Date.now();
  const withPropertyAddress = cases.filter((fc) => fc.property?.propertyStreetAddress).length;
  const withCountyValue = cases.filter((fc) => fc.property?.appraisedValueCents !== null || fc.property?.estimatedMarketValueCents !== null).length;
  const newThisWeek = cases.filter((fc) => now - fc.createdAt.getTime() <= 7 * 24 * 60 * 60 * 1000).length;
  const futureSaleTimes = cases
    .flatMap((fc) => fc.sales.map((s) => s.saleDate?.getTime() ?? null))
    .filter((t): t is number => t !== null && t >= now);
  const nextAuctionISO = futureSaleTimes.length ? new Date(Math.min(...futureSaleTimes)).toISOString() : null;

  const summary: InvestorCountySummary = {
    countyName: county.name,
    countySlug: county.slug,
    stateAbbr: county.state,
    nextAuctionISO,
    visibleOpportunities: cases.length,
    withPropertyAddress,
    withCountyValue,
    newThisWeek,
    sourceNoticesProcessed: await prisma.foreclosureCase.count({ where: { countyId: county.id, archivedAt: null } }),
  };

  const savedIds = profileId
    ? (await prisma.savedProperty.findMany({ where: { profileId, propertyId: { in: listings.map((l) => l.id) } }, select: { propertyId: true } })).map((s) => s.propertyId)
    : [];

  const ctaCopy =
    summary.visibleOpportunities > listings.length
      ? `Unlock all ${summary.visibleOpportunities} foreclosures in ${county.name} County.`
      : `Unlock full details for every foreclosure in ${county.name} County.`;

  return (
    <SavedPropertiesProvider isAuthenticated={Boolean(profileId)} initialSavedIds={savedIds}>
      <BrowseView
        listings={listings}
        summary={summary}
        initialView={searchParams.view === "map" ? "map" : "list"}
        ctaBanner={
          !unlocked ? (
            <Card className="border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-500/10">
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">{ctaCopy}</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">$7/month &middot; Free 7-day trial &middot; Cancel anytime</p>
                </div>
                <Link href={`/sign-up?trialCounty=${county.slug}`}>
                  <Button size="lg">Start free trial</Button>
                </Link>
              </CardContent>
            </Card>
          ) : undefined
        }
      />

      {!unlocked && (
        <div className="container-page pb-10">
          <Card className="border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                Ready to see every foreclosure and every locked field in {county.name} County?
              </p>
              <Link href={`/sign-up?trialCounty=${county.slug}`}>
                <Button variant="outline">Start free trial</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </SavedPropertiesProvider>
  );
}
