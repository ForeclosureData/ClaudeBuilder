import { revalidatePath } from "next/cache";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/properties/empty-state";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function updateStatus(reportId: string, status: "REVIEWED" | "APPLIED" | "REJECTED") {
  "use server";
  const actorId = await getCurrentProfileId();
  await prisma.correctionReport.update({ where: { id: reportId }, data: { status, resolvedAt: new Date(), resolvedById: actorId } });
  await prisma.auditLog.create({ data: { actorId, action: `CORRECTION_${status}`, entityType: "CorrectionReport", entityId: reportId } });
  revalidatePath("/admin/corrections");
}

export default async function AdminCorrectionsPage() {
  const reports = await prisma.correctionReport.findMany({ where: { status: "OPEN" }, include: { profile: true }, orderBy: { createdAt: "asc" } });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">User correction reports</h1>
      <div className="space-y-3">
        {reports.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-neutral-500">
                  {r.profile?.email ?? "Anonymous"} &middot; {formatDate(r.createdAt.toISOString())} {r.fieldName && <Badge tone="neutral">{r.fieldName}</Badge>}
                </p>
                <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">{r.description}</p>
              </div>
              <div className="flex gap-2">
                <form action={updateStatus.bind(null, r.id, "APPLIED")}><Button size="sm">Apply</Button></form>
                <form action={updateStatus.bind(null, r.id, "REJECTED")}><Button size="sm" variant="ghost">Dismiss</Button></form>
              </div>
            </div>
          </Card>
        ))}
        {reports.length === 0 && (
          <Card className="p-4">
            <EmptyState message="No open correction reports." />
          </Card>
        )}
      </div>
    </div>
  );
}
