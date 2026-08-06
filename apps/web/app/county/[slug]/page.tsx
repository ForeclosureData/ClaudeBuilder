import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@foreclosuredata/database";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getCountyStats } from "@/lib/county-stats";
import { buildForeclosureCaseWhere, foreclosureCaseListInclude } from "@/lib/properties";
import { EmptyState } from "@/components/properties/empty-state";
import { RequestCountyForm } from "@/components/search/request-county-form";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrencyCents, formatDate } from "@/lib/utils";
import { saleStatusLabels } from "@foreclosuredata/config";

export const revalidate = 60;

export default async function CountyPage({ params }: { params: { slug: string } }) {
  const county = await prisma.county.findUnique({ where: { slug: params.slug } });
  if (!county) notFound();

  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);
  const unlocked = hasFullAccessToCounty(entitlement, county.slug);

  const stats = await getCountyStats(county.id);

  const cases = await prisma.foreclosureCase.findMany({
    where: buildForeclosureCaseWhere({ countySlug: county.slug }),
    include: foreclosureCaseListInclude(),
    orderBy: { sales: { _count: "desc" } },
    take: unlocked ? 50 : 8,
  });

  return (
    <div className="container-page py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{county.name} County</h1>
        <p className="mt-1 text-neutral-500">
          {stats.nextSaleDate ? `Next auction ${formatDate(stats.nextSaleDate)}` : "No upcoming auction scheduled"} &middot;{" "}
          {stats.upcomingCount} upcoming {stats.upcomingCount === 1 ? "property" : "properties"}
        </p>
      </div>

      {!county.isActive ? (
        <div className="space-y-6">
          <EmptyState
            message={`${county.name} County is coming soon.`}
            hint="We're prioritizing counties by user demand, foreclosure volume, and technical feasibility."
          />
          <Card className="mx-auto max-w-md p-4">
            <p className="mb-3 text-center text-sm text-neutral-500">Want us to prioritize {county.name} County?</p>
            <RequestCountyForm prefill={`${county.name} County`} />
          </Card>
        </div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Upcoming" value={String(stats.upcomingCount)} />
            <Stat label="Avg. est. value" value={formatCurrencyCents(stats.averageAppraisedValueCents)} />
            <Stat label="Residential" value={String(stats.residentialCount)} />
            <Stat label="Commercial" value={String(stats.commercialCount)} />
            <Stat label="Avg. days to sale" value={stats.averageDaysUntilSale !== null ? String(stats.averageDaysUntilSale) : "—"} />
            <Stat label="Newest notice" value={stats.newestNoticeAt ? formatDate(stats.newestNoticeAt) : "—"} />
          </div>

          {!unlocked && (
            <Card className="mb-6 border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-500/10">
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">Unlock every foreclosure in {county.name} County.</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">$7/month &middot; Free 7-day trial &middot; Cancel anytime</p>
                </div>
                <Link href={`/sign-up?trialCounty=${county.slug}`}>
                  <Button size="lg">Start free trial</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <Table>
              <Thead>
                <Tr>
                  <Th>Property</Th>
                  <Th>City</Th>
                  <Th>Sale date</Th>
                  <Th>Status</Th>
                  {unlocked && <Th>Borrower</Th>}
                  {unlocked && <Th>Est. value</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {cases.map((fc) => (
                  <Tr key={fc.id}>
                    <Td>
                      {unlocked && fc.property ? (
                        <Link href={`/properties/${fc.property.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                          {fc.property.propertyStreetAddress ?? "Address pending review"}
                        </Link>
                      ) : (
                        <LockedCell width="w-40" />
                      )}
                    </Td>
                    <Td>{fc.property?.city ?? "—"}</Td>
                    <Td>{formatDate(fc.sales[0]?.saleDate?.toISOString() ?? null)}</Td>
                    <Td><Badge tone={fc.status === "CANCELED" ? "danger" : "success"}>{saleStatusLabels[fc.status]}</Badge></Td>
                    {unlocked && <Td>{fc.borrower?.fullName ?? "Unknown"}</Td>}
                    {unlocked && <Td>{formatCurrencyCents(fc.property?.appraisedValueCents ?? null)}</Td>}
                  </Tr>
                ))}
              </Tbody>
            </Table>
            {cases.length === 0 && (
              <EmptyState message="No upcoming foreclosure sales currently scheduled." hint="Check back soon." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </Card>
  );
}

function LockedCell({ width }: { width: string }) {
  return <span className={`inline-block select-none rounded bg-neutral-200 py-1 text-transparent blur-sm dark:bg-neutral-700 ${width}`}>Locked value</span>;
}
