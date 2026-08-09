import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getPublicForeclosureCases } from "@/lib/properties";
import { PropertyFilters } from "@/components/properties/property-filters";
import { ConfidenceBadge } from "@/components/properties/confidence-badge";
import { EmptyState } from "@/components/properties/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, daysUntil, formatBorrowerName, formatOriginalPrincipal } from "@/lib/utils";
import { saleStatusLabels } from "@foreclosuredata/config";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * "My Counties" cross-county view for signed-in users — mainly useful on
 * the Texas Unlimited plan. Free/County-plan viewers are usually better
 * served by the public /county/[slug] page for the one county they care
 * about; this page still works for them, gated per-row by
 * hasFullAccessToCounty since a County-plan subscriber only unlocked one.
 */
export default async function PropertiesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const profileId = await getCurrentProfileId();
  const entitlement = await resolveEntitlement(profileId);
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const counties = await prisma.county.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  const { cases, totalCount } = await getPublicForeclosureCases(
    {
      countySlug: searchParams.countySlug,
      city: searchParams.city,
      zipCode: searchParams.zipCode,
      propertyType: searchParams.propertyType,
      classification: searchParams.classification as "RESIDENTIAL" | "COMMERCIAL" | undefined,
      borrowerSearch: searchParams.borrowerSearch,
      lenderSearch: searchParams.lenderSearch,
      saleDateFrom: searchParams.saleDateFrom,
      saleDateTo: searchParams.saleDateTo,
      manualReviewStatus: searchParams.manualReviewStatus as never,
      savedOnly: searchParams.savedOnly === "true",
      profileId,
    },
    { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE },
  );

  const savedPropertyIds = profileId
    ? new Set((await prisma.savedProperty.findMany({ where: { profileId }, select: { propertyId: true } })).map((s) => s.propertyId))
    : new Set<string>();

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">My counties</h1>
        {entitlement.plan !== "UNLIMITED" && (
          <Link href="/pricing">
            <Badge tone="brand">Upgrade to Texas Unlimited to unlock every supported county</Badge>
          </Link>
        )}
      </div>

      <Card className="mb-6 p-4">
        <PropertyFilters counties={counties.map((c) => ({ slug: c.slug, name: c.name }))} />
      </Card>

      <Card>
        <Table>
          <Thead>
            <Tr>
              <Th>Sale date</Th>
              <Th>Property</Th>
              <Th>Type</Th>
              <Th>Borrower</Th>
              <Th>Lender</Th>
              <Th>Original principal</Th>
              <Th>Status</Th>
              <Th>Address confidence</Th>
            </Tr>
          </Thead>
          <Tbody>
            {cases.map((fc) => {
              const sale = fc.sales[0];
              const days = daysUntil(sale?.saleDate?.toISOString() ?? null);
              const unlocked = hasFullAccessToCounty(entitlement, fc.county.slug);
              return (
                <Tr key={fc.id}>
                  <Td>
                    <div className="font-medium text-neutral-900 dark:text-neutral-50">{formatDate(sale?.saleDate?.toISOString() ?? null)}</div>
                    {days !== null && days >= 0 && <div className="text-xs text-neutral-500">{days} day{days === 1 ? "" : "s"} away</div>}
                  </Td>
                  <Td>
                    <Link href={`/properties/${fc.property?.id ?? fc.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                      {fc.property?.propertyStreetAddress ?? `${fc.property?.city ?? fc.county.name} (address pending review)`}
                    </Link>
                    {fc.property && savedPropertyIds.has(fc.property.id) && <Badge tone="brand" className="ml-2">Saved</Badge>}
                    <div className="text-xs text-neutral-500">{fc.property?.city}, {fc.county.name} County</div>
                  </Td>
                  <Td>{fc.property?.propertyType ?? "UNKNOWN"}</Td>
                  <Td>{unlocked ? formatBorrowerName(fc.borrower?.fullName) : <LockedCell />}</Td>
                  <Td>{unlocked ? fc.loan?.currentMortgagee?.name ?? fc.loan?.originalLender?.name ?? "Unknown" : <LockedCell />}</Td>
                  <Td>{unlocked ? formatOriginalPrincipal(fc.loan?.originalPrincipalAmountCents ?? null) : <LockedCell />}</Td>
                  <Td><Badge tone={fc.status === "CANCELED" ? "danger" : fc.status === "SOLD" ? "neutral" : "success"}>{saleStatusLabels[fc.status]}</Badge></Td>
                  <Td><ConfidenceBadge confidence={fc.property?.addressResolutionConfidence ?? null} /></Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        {cases.length === 0 && (
          <EmptyState message="No upcoming foreclosure sales currently scheduled." hint="Check back soon, or adjust your filters." />
        )}
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
        <span>Page {page} of {totalPages} &middot; {totalCount} total</span>
        <div className="flex gap-2">
          {page > 1 && <Link className="underline" href={`?${new URLSearchParams({ ...searchParams, page: String(page - 1) } as Record<string, string>).toString()}`}>Previous</Link>}
          {page < totalPages && <Link className="underline" href={`?${new URLSearchParams({ ...searchParams, page: String(page + 1) } as Record<string, string>).toString()}`}>Next</Link>}
        </div>
      </div>
    </div>
  );
}

function LockedCell() {
  return <span className="select-none rounded bg-neutral-200 px-2 py-0.5 text-transparent blur-sm dark:bg-neutral-700">Locked</span>;
}
