import { revalidatePath } from "next/cache";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function toggleSource(sourceId: string, enable: boolean) {
  "use server";
  const actorId = await getCurrentProfileId();
  const before = await prisma.countySource.findUnique({ where: { id: sourceId } });
  await prisma.countySource.update({ where: { id: sourceId }, data: { isEnabled: enable } });
  await prisma.auditLog.create({
    data: {
      actorId,
      action: enable ? "ENABLE_COUNTY_SOURCE" : "DISABLE_COUNTY_SOURCE",
      entityType: "CountySource",
      entityId: sourceId,
      beforeJson: before ? { isEnabled: before.isEnabled } : undefined,
      afterJson: { isEnabled: enable },
    },
  });
  revalidatePath("/admin/sources");
}

export default async function AdminSourcesPage() {
  const sources = await prisma.countySource.findMany({ include: { county: true }, orderBy: { county: { name: "asc" } } });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">County sources</h1>
      <div className="space-y-3">
        {sources.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-50">{s.county.name} County — {s.name}</p>
                <p className="text-xs text-neutral-500">
                  {s.accessMethod ?? "access method unset"} &middot; vendor: {s.sourceVendor ?? "unknown"} &middot; CAPTCHA:{" "}
                  {s.captchaPresent ? "yes" : "no"} &middot; embedded text: {s.documentsHaveEmbeddedText ? "yes" : "no"}
                </p>
                {s.lastErrorMessage && <p className="mt-1 text-xs text-danger-500">{s.lastErrorMessage}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={s.isEnabled ? "success" : "neutral"}>{s.isEnabled ? "Enabled" : "Disabled"}</Badge>
                <form action={toggleSource.bind(null, s.id, !s.isEnabled)}>
                  <Button size="sm" variant="outline" type="submit">{s.isEnabled ? "Disable" : "Enable"}</Button>
                </form>
              </div>
            </div>
          </Card>
        ))}
        {sources.length === 0 && <p className="text-sm text-neutral-500">No county sources configured yet.</p>}
      </div>
    </div>
  );
}
