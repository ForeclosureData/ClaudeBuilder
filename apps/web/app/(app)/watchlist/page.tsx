import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { EmptyState } from "@/components/properties/empty-state";
import { Card } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { saleStatusLabels } from "@foreclosuredata/config";

export default async function WatchlistPage() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return null; // middleware redirects unauthenticated visitors before this renders

  const saved = await prisma.savedProperty.findMany({
    where: { profileId },
    include: {
      property: {
        include: { county: true, foreclosureCases: { orderBy: { createdAt: "desc" }, take: 1, include: { sales: { orderBy: { saleDate: "asc" }, take: 1 } } } },
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
              return (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/properties/${s.property.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                      {s.property.propertyStreetAddress ?? `${s.property.city ?? "Address pending review"}`}
                    </Link>
                  </Td>
                  <Td>{s.property.county.name}</Td>
                  <Td>{formatDate(fc?.sales[0]?.saleDate?.toISOString() ?? null)}</Td>
                  <Td>{fc && <Badge tone={fc.status === "CANCELED" ? "danger" : "success"}>{saleStatusLabels[fc.status]}</Badge>}</Td>
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
