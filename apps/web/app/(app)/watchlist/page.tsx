import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { EmptyState } from "@/components/properties/empty-state";
import { Card } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { saleStatusLabels } from "@foreclosuredata/config";
import { PUBLICATION_EXTRA_INCLUDE, isPubliclyVisible } from "@/lib/publicationVisibility";

export default async function WatchlistPage() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return null; // middleware redirects unauthenticated visitors before this renders

  const saved = await prisma.savedProperty.findMany({
    where: { profileId },
    include: {
      property: {
        include: {
          county: true,
          foreclosureCases: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: { borrower: true, sales: { orderBy: { saleDate: "asc" } }, ...PUBLICATION_EXTRA_INCLUDE } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Saved properties</h1>
      <Card>
        <Table>
          <Thead>
            <Tr><Th>Property</Th><Th>County</Th><Th>Sale date</Th><Th>Status</Th></Tr>
          </Thead>
          <Tbody>
            {saved.map((s) => {
              const fc = s.property.foreclosureCases[0];
              const visible = fc ? isPubliclyVisible({ ...fc, property: s.property }) : false;
              return (
                <Tr key={s.id}>
                  <Td>
                    {visible ? (
                      <Link href={`/properties/${s.property.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                        {s.property.propertyStreetAddress ?? `${s.property.city ?? "Address pending review"}`}
                      </Link>
                    ) : (
                      <span className="text-neutral-500">{s.property.propertyStreetAddress ?? s.property.city ?? "Saved property"}</span>
                    )}
                  </Td>
                  <Td>{s.property.county.name}</Td>
                  <Td>{formatDate(fc?.sales[0]?.saleDate?.toISOString() ?? null)}</Td>
                  <Td>
                    {visible && fc ? (
                      <Badge tone={fc.status === "CANCELED" ? "danger" : "success"}>{saleStatusLabels[fc.status]}</Badge>
                    ) : (
                      <Badge tone="neutral">No longer available</Badge>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        {saved.length === 0 && <EmptyState message="No saved properties yet." hint="Tap the heart icon on any property to save it here." />}
      </Card>
    </div>
  );
}
