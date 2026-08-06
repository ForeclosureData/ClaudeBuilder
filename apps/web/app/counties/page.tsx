import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestCountyForm } from "@/components/search/request-county-form";

export const revalidate = 300;

/** The only place that should ever claim statewide coverage is this page — and only once it's true. */
export default async function CountiesPage() {
  const counties = await prisma.county.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  const supported = counties.filter((c) => c.isActive);
  const comingSoon = counties.filter((c) => !c.isActive);

  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Texas counties</h1>
      <p className="mt-2 text-neutral-500">
        ForeclosureData is Texas-first, starting with Hidalgo County. We only list a county as
        available once ingestion, extraction, and address resolution are reliable for it —
        everything else below is on the roadmap.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-400">Supported now</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {supported.map((c) => (
          <Link key={c.id} href={`/county/${c.slug}`}>
            <Card className="flex items-center justify-between p-4 hover:border-brand-300">
              <span className="font-medium text-neutral-900 dark:text-neutral-50">{c.name} County</span>
              <Badge tone="success">Supported</Badge>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-400">Coming soon</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {comingSoon.map((c) => (
          <Link key={c.id} href={`/county/${c.slug}`}>
            <Card className="flex items-center justify-between p-4 hover:border-brand-300">
              <span className="font-medium text-neutral-900 dark:text-neutral-50">{c.name} County</span>
              <Badge tone="neutral">{formatStatus(c.availabilityStatus)}</Badge>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-10 p-5">
        <p className="mb-3 font-medium text-neutral-900 dark:text-neutral-50">Don&rsquo;t see your county?</p>
        <RequestCountyForm />
      </Card>
    </div>
  );
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}
