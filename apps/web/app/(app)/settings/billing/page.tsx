import { prisma } from "@foreclosuredata/database";
import { resolveEntitlement } from "@foreclosuredata/auth/entitlement";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function BillingPage() {
  const profileId = await getCurrentProfileId();
  if (!profileId) return null;

  const [entitlement, subscription, profile] = await Promise.all([
    resolveEntitlement(profileId),
    prisma.subscription.findUnique({ where: { profileId }, include: { selectedCounty: true } }),
    prisma.profile.findUnique({ where: { id: profileId } }),
  ]);

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Account &amp; billing</h1>
      <Card>
        <CardHeader><CardTitle>Subscription</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Email" value={profile?.email ?? "—"} />
          <Row label="Plan">
            <Badge tone={entitlement.plan === "FREE" ? "neutral" : "success"}>
              {entitlement.plan === "FREE" ? "Free" : entitlement.plan === "COUNTY" ? "County Plan" : "Texas Unlimited"}
            </Badge>
          </Row>
          {entitlement.selectedCountySlug && <Row label="County" value={subscription?.selectedCounty?.name ?? entitlement.selectedCountySlug} />}
          <Row label="Status" value={subscription?.status ?? "INACTIVE"} />
          {subscription?.trialEndsAt && <Row label="Trial ends" value={formatDate(subscription.trialEndsAt.toISOString())} />}
          {subscription?.currentPeriodEnd && <Row label="Renews" value={formatDate(subscription.currentPeriodEnd.toISOString())} />}
          {entitlement.canExportCsv && (
            <Row label="CSV exports used" value={`${entitlement.csvExportsUsedThisMonth} / ${entitlement.monthlyCsvExportLimit} this month`} />
          )}
          {subscription?.isFoundingMember && <Row label="Founding member" value="Yes — promotional period applied" />}
          {subscription?.status === "PAYMENT_FAILED" && subscription.paymentGracePeriodEndsAt && (
            <p className="rounded-md bg-danger-50 p-2 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
              Your last payment failed. Update your payment method by {formatDate(subscription.paymentGracePeriodEndsAt.toISOString())} to keep access.
            </p>
          )}
          <div className="flex gap-2 pt-2">
            {subscription?.externalCustomerId && subscription.billingProvider === "STRIPE" ? (
              <form action="/api/billing/portal" method="POST">
                <Button type="submit" variant="outline">Manage billing</Button>
              </form>
            ) : subscription?.externalCustomerId ? (
              <Link href="/settings/billing/payment-method"><Button variant="outline">Update payment method</Button></Link>
            ) : (
              <Link href="/pricing"><Button>Choose a plan</Button></Link>
            )}
            {subscription && subscription.status !== "CANCELED" && subscription.externalSubscriptionId && (
              <form action="/api/billing/cancel" method="POST">
                <Button type="submit" variant="ghost">Cancel subscription</Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-2 last:border-0 dark:border-neutral-800">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-900 dark:text-neutral-50">{children ?? value}</span>
    </div>
  );
}
