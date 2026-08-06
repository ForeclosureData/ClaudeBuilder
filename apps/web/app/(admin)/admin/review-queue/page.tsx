import { revalidatePath } from "next/cache";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/properties/empty-state";

export const dynamic = "force-dynamic";

async function resolveTask(taskId: string) {
  "use server";
  const actorId = await getCurrentProfileId();
  await prisma.manualReviewTask.update({ where: { id: taskId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId, action: "RESOLVE_MANUAL_REVIEW_TASK", entityType: "ManualReviewTask", entityId: taskId } });
  revalidatePath("/admin/review-queue");
}

export default async function ReviewQueuePage() {
  const tasks = await prisma.manualReviewTask.findMany({
    where: { status: "OPEN" },
    include: { sourceDocument: { include: { county: true } }, foreclosureCase: { include: { property: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Manual review queue</h1>
      <div className="space-y-3">
        {tasks.map((t) => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge tone="warning">{t.reason.replace(/_/g, " ")}</Badge>
                <p className="mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  {t.sourceDocument?.county.name ?? "Unknown county"} — {t.sourceDocument?.filename ?? t.foreclosureCaseId}
                </p>
                {t.notes && <p className="mt-1 text-sm text-neutral-500">{t.notes}</p>}
              </div>
              <form action={resolveTask.bind(null, t.id)}>
                <Button size="sm" type="submit">Mark resolved</Button>
              </form>
            </div>
          </Card>
        ))}
        {tasks.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState message="No open manual review tasks." hint="Everything the pipeline flagged has been resolved." />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
