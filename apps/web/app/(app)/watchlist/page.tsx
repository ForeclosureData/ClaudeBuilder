import { prisma } from "@foreclosuredata/database";
import { hasFullAccessToCounty } from "@foreclosuredata/types";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { PUBLICATION_EXTRA_INCLUDE, isPubliclyVisible } from "@/lib/publicationVisibility";
import { toInvestorListing } from "@/lib/investor/adapter";
import { PropertyCard } from "@/components/investor/property-card";
import { SavedPropertiesProvider } from "@/components/investor/saved-context";
import { EmptyState } from "@/components/properties/empty-state";
import { Card } from "@/components/ui/card";

export default async function WatchlistPage() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return null; // middleware redirects unauthenticated visitors before this renders

  const entitlement = await resolveEntitlement(profileId);

  const saved = await prisma.savedProperty.findMany({
    where: { profileId },
    include: {
      property: {
        include: {
          county: true,
          appraisalValueHistory: { orderBy: { taxYear: "desc" }, take: 1 },
          foreclosureCases: {
            where: { archivedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              ...PUBLICATION_EXTRA_INCLUDE,
              county: true,
              legalDescriptions: true,
              sales: { orderBy: { saleDate: "asc" }, include: { trustee: { include: { person: true, organization: true } } } },
              loan: { include: { currentMortgagee: true, originalLender: true, mortgageServicer: true } },
              borrower: true,
              currentOwner: true,
              documents: { select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const visibleListings = saved
    .map((s) => {
      const fc = s.property.foreclosureCases[0];
      if (!fc || !isPubliclyVisible({ ...fc, property: s.property })) return null;
      const unlocked = hasFullAccessToCounty(entitlement, s.property.county.slug);
      return toInvestorListing({ ...fc, property: s.property }, unlocked);
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const unavailableCount = saved.length - visibleListings.length;

  return (
    <SavedPropertiesProvider isAuthenticated initialSavedIds={saved.map((s) => s.propertyId)}>
      <div className="container-page py-6 sm:py-8">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50 sm:text-3xl">Saved Properties</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {visibleListings.length} saved {visibleListings.length === 1 ? "property" : "properties"}
        </p>

        {visibleListings.length === 0 && unavailableCount === 0 && (
          <div className="mt-8">
            <EmptyState message="No saved properties yet." hint="Tap the heart icon on any property to save it here." />
          </div>
        )}

        {visibleListings.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleListings.map((l) => (
              <PropertyCard key={l.id} listing={l} />
            ))}
          </div>
        )}

        {unavailableCount > 0 && (
          <Card className="mt-6 p-4 text-sm text-neutral-500">
            {unavailableCount} previously-saved {unavailableCount === 1 ? "property is" : "properties are"} no longer available (the sale may have
            concluded or the listing is pending re-verification).
          </Card>
        )}
      </div>
    </SavedPropertiesProvider>
  );
}
