import { prisma } from "@foreclosuredata/database";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrencyCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [
    countySources,
    documentsDiscovered,
    documentsProcessed,
    failedJobs,
    deadLetterJobs,
    duplicateDocuments,
    unresolvedAddresses,
    lowConfidenceDocs,
    pendingReview,
    openCorrections,
    activeSubscriptions,
    aiBudget,
    ocrBudget,
    monthSpend,
    countyRequests,
  ] = await Promise.all([
    prisma.countySource.findMany({ include: { county: true } }),
    prisma.sourceDocument.count(),
    prisma.sourceDocument.count({ where: { status: "SUMMARIZED" } }),
    prisma.processingJob.count({ where: { status: "FAILED" } }),
    prisma.processingJob.count({ where: { status: "DEAD_LETTER" } }),
    prisma.sourceDocument.count({ where: { status: "DUPLICATE" } }),
    prisma.property.count({ where: { addressResolutionMethod: "UNRESOLVED" } }),
    prisma.sourceDocument.count({ where: { extractionConfidence: { lt: 0.6 } } }),
    prisma.manualReviewTask.count({ where: { status: "OPEN" } }),
    prisma.correctionReport.count({ where: { status: "OPEN" } }),
    prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PROMOTIONAL"] } } }),
    prisma.budgetLimit.findUnique({ where: { key: "AI_MONTHLY_BUDGET_CENTS" } }),
    prisma.budgetLimit.findUnique({ where: { key: "OCR_MONTHLY_BUDGET_CENTS" } }),
    prisma.sourceDocument.aggregate({ _sum: { processingCostCents: true } }),
    prisma.countyRequest.count({ where: { status: "OPEN" } }),
  ]);

  const mrrCents = await estimateMrrCents(activeSubscriptions.map((s) => ({ plan: s.plan, billingInterval: s.billingInterval })));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Admin overview</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Subscribers" value={String(activeSubscriptions.length)} />
        <Stat label="Est. MRR" value={formatCurrencyCents(mrrCents)} />
        <Stat label="Documents discovered" value={String(documentsDiscovered)} />
        <Stat label="Documents processed" value={String(documentsProcessed)} />
        <Stat label="Failed jobs" value={String(failedJobs)} tone={failedJobs > 0 ? "danger" : undefined} />
        <Stat label="Dead-lettered jobs" value={String(deadLetterJobs)} tone={deadLetterJobs > 0 ? "danger" : undefined} />
        <Stat label="Duplicate documents" value={String(duplicateDocuments)} />
        <Stat label="Unresolved addresses" value={String(unresolvedAddresses)} tone={unresolvedAddresses > 0 ? "warning" : undefined} />
        <Stat label="Low-confidence documents" value={String(lowConfidenceDocs)} tone={lowConfidenceDocs > 0 ? "warning" : undefined} />
        <Stat label="Open manual reviews" value={String(pendingReview)} tone={pendingReview > 0 ? "warning" : undefined} />
        <Stat label="Open correction reports" value={String(openCorrections)} />
        <Stat label="Open county requests" value={String(countyRequests)} />
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Cost</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total processing spend" value={formatCurrencyCents(monthSpend._sum.processingCostCents ?? 0)} />
        <Stat
          label="AI monthly budget"
          value={aiBudget ? formatCurrencyCents(aiBudget.limitCents) : "Not set"}
        />
        <Stat
          label="OCR monthly budget"
          value={ocrBudget ? formatCurrencyCents(ocrBudget.limitCents) : "Not set"}
        />
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">County source health</h2>
      <Card>
        <CardContent className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {countySources.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-50">{s.county.name} County — {s.name}</p>
                <p className="text-xs text-neutral-500">
                  {s.adapterKey} &middot; {s.connectorHealth} &middot; last sync{" "}
                  {s.lastSuccessfulSyncAt ? s.lastSuccessfulSyncAt.toLocaleString() : "never"}
                </p>
              </div>
              <div className="text-right text-xs text-neutral-500">
                <p>{s.noticesDiscoveredCount} discovered / {s.documentsProcessedCount} processed</p>
                <p>{s.manualReviewCount} manual review &middot; {s.connectorFailureCount} failures</p>
              </div>
            </div>
          ))}
          {countySources.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">No county sources configured yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return (
    <Card className={`p-3 ${tone === "danger" ? "border-danger-300" : tone === "warning" ? "border-warning-300" : ""}`}>
      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </Card>
  );
}

async function estimateMrrCents(subs: Array<{ plan: string; billingInterval: string | null }>): Promise<number> {
  const plans = await prisma.planConfig.findMany();
  const priceByPlan = new Map(plans.map((p) => [p.planKey, p.priceCents]));
  return subs.reduce((sum, s) => {
    const price = priceByPlan.get(s.plan as never) ?? 0;
    return sum + (s.billingInterval === "ANNUAL" ? Math.round(price / 12) : price);
  }, 0);
}
