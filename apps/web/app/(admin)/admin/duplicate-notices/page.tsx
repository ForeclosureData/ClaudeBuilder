import { revalidatePath } from "next/cache";
import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/properties/empty-state";
import { formatCurrencyCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Admin review surface for PossibleDuplicateNoticeLink rows -- two
 * DISTINCT ForeclosureCase records (each its own real countyFilingNumber)
 * that the content/economic duplicate-detection engine (see
 * scoreDuplicateEvidence in foreclosure-core) flagged as possibly
 * describing the same real-world foreclosure event. Confirming or
 * rejecting here NEVER merges, archives, or touches either case's own
 * identity fields -- it only records a reviewer's judgment on the link
 * itself, for the SOURCE RECORD COUNT vs UNIQUE FORECLOSURE EVENT COUNT
 * distinction (see docs/DEPLOYMENT.md).
 */

async function confirmDuplicate(linkId: string, formData: FormData) {
  "use server";
  const actorId = await getCurrentProfileId();
  const notes = String(formData.get("notes") ?? "").trim();
  await prisma.possibleDuplicateNoticeLink.update({
    where: { id: linkId },
    data: { status: "CONFIRMED_DUPLICATE", reviewedByUserId: actorId, reviewedAt: new Date(), reviewNotes: notes || null },
  });
  await prisma.auditLog.create({ data: { actorId, action: "CONFIRM_DUPLICATE_NOTICE_LINK", entityType: "PossibleDuplicateNoticeLink", entityId: linkId } });
  revalidatePath("/admin/duplicate-notices");
}

async function rejectDistinct(linkId: string, formData: FormData) {
  "use server";
  const actorId = await getCurrentProfileId();
  const notes = String(formData.get("notes") ?? "").trim();
  await prisma.possibleDuplicateNoticeLink.update({
    where: { id: linkId },
    data: { status: "REJECTED_DISTINCT", reviewedByUserId: actorId, reviewedAt: new Date(), reviewNotes: notes || null },
  });
  await prisma.auditLog.create({ data: { actorId, action: "REJECT_DUPLICATE_NOTICE_LINK", entityType: "PossibleDuplicateNoticeLink", entityId: linkId } });
  revalidatePath("/admin/duplicate-notices");
}

const caseInclude = {
  county: true,
  property: true,
  borrower: true,
  grantor: true,
  loan: { include: { originalLender: true, currentMortgagee: true } },
  sales: { orderBy: { saleDate: "desc" as const }, take: 1 },
  documents: { orderBy: { dateCollected: "desc" as const }, take: 1 },
} as const;

function caseSummary(fc: {
  caseNumber: string | null;
  countyFilingNumber: string | null;
  county: { name: string };
  property: { propertyStreetAddress: string | null } | null;
  borrower: { fullName: string } | null;
  grantor: { fullName: string } | null;
  loan: { originalPrincipalAmountCents: number | null } | null;
  sales: Array<{ saleDate: Date | null }>;
  documents: Array<{ documentUrl: string }>;
}) {
  return {
    label: fc.caseNumber ?? fc.countyFilingNumber ?? "Unknown filing",
    county: fc.county.name,
    address: fc.property?.propertyStreetAddress ?? "No address on record",
    owner: fc.borrower?.fullName ?? fc.grantor?.fullName ?? "Unknown",
    principal: fc.loan?.originalPrincipalAmountCents ?? null,
    saleDate: fc.sales[0]?.saleDate ?? null,
    noticeUrl: fc.documents[0]?.documentUrl ?? null,
  };
}

export default async function DuplicateNoticesPage() {
  const links = await prisma.possibleDuplicateNoticeLink.findMany({
    where: { status: "OPEN" },
    include: { caseA: { include: caseInclude }, caseB: { include: caseInclude } },
    orderBy: [{ confidence: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Possible duplicate notices</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Two distinct county filings (each a real, legally meaningful record with its own filing number) that share enough evidence to possibly
        describe the same real-world foreclosure event. Confirming a link here never merges or archives either case — county filing numbers stay
        exactly as filed. It only records that both notices likely belong to one underlying event, so future investor-facing counts don&apos;t
        silently double an event that was filed twice.
      </p>
      <div className="space-y-4">
        {links.map((link) => {
          const a = caseSummary(link.caseA);
          const b = caseSummary(link.caseB);
          const confidenceTone = link.confidence === "CONFIRMED_SAME_EVENT" ? "danger" : link.confidence === "LIKELY_SAME_EVENT" ? "warning" : "neutral";

          return (
            <Card key={link.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Badge tone={confidenceTone}>{link.confidence.replace(/_/g, " ")}</Badge>
                <span className="text-xs text-neutral-400">Score: {Math.round(link.score * 100)}%</span>
              </div>
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                {[a, b].map((c, i) => (
                  <div key={i} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                    <p className="font-medium text-neutral-900 dark:text-neutral-50">{c.label} &middot; {c.county} County</p>
                    <p className="text-neutral-500">{c.address}</p>
                    <p className="text-neutral-500">Owner: {c.owner}</p>
                    <p className="text-neutral-500">
                      Original principal: {formatCurrencyCents(c.principal)} &middot; Sale date: {c.saleDate ? c.saleDate.toISOString().slice(0, 10) : "—"}
                    </p>
                    {c.noticeUrl && (
                      <Link href={c.noticeUrl} target="_blank" className="mt-1 inline-block text-xs text-brand-600 underline dark:text-brand-400">
                        View original notice
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              <p className="mb-1 text-xs text-neutral-500">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Matched:</span> {link.matchedFields.join(", ") || "none"}
              </p>
              {link.conflictingFields.length > 0 && (
                <p className="mb-1 text-xs text-red-600 dark:text-red-400">
                  <span className="font-medium">Conflicting:</span> {link.conflictingFields.join(", ")}
                </p>
              )}
              {link.explanation && <p className="mb-3 text-xs text-neutral-400">{link.explanation}</p>}
              <div className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <form action={confirmDuplicate.bind(null, link.id)} className="flex items-end gap-2">
                  <label className="text-xs text-neutral-500">
                    Notes
                    <input name="notes" className="mt-1 block h-9 w-56 rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                  </label>
                  <Button size="sm" type="submit">Confirm same event</Button>
                </form>
                <form action={rejectDistinct.bind(null, link.id)}>
                  <Button size="sm" variant="outline" type="submit">Reject — distinct events</Button>
                </form>
              </div>
            </Card>
          );
        })}
        {links.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState message="No open possible-duplicate notices." hint="Nothing currently flagged by the content/economic duplicate-detection engine." />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
