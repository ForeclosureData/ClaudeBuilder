import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { getDemoCaseById, DEMO_HIDALGO_CASES } from "@/lib/demo/fixtures/hidalgo-demo-cases";
import { formatMoney, formatShortDate } from "@/lib/demo/format";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const demoCase = getDemoCaseById(params.id);
  return { title: demoCase ? `Source Notice — ${demoCase.caseNumber}` : "Notice not found" };
}

/**
 * Placeholder "original notice" preview for the demo -- there is no real
 * scanned PDF behind fixture cases, so this renders a clearly-labeled
 * mock document summary instead of linking to a file that doesn't exist.
 */
export default function DemoSourceNoticePage({ params }: { params: { id: string } }) {
  const demoCase = getDemoCaseById(params.id);
  if (!demoCase) notFound();

  return (
    <div className="container-page py-8">
      <Link href={`/demo/property/${demoCase.id}`} className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to property
      </Link>

      <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2 text-neutral-400">
          <FileText className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-wide">Demo placeholder — not a real scanned document</span>
        </div>
        <h1 className="mt-3 text-xl font-semibold text-neutral-900">Notice of Trustee's Sale</h1>
        <p className="text-sm text-neutral-500">Case {demoCase.caseNumber} · Hidalgo County, Texas</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-neutral-500">Property Address</dt>
            <dd className="font-medium text-neutral-900">{demoCase.address ?? "Not stated in notice"}, {demoCase.city}, TX {demoCase.zip}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Sale Date</dt>
            <dd className="font-medium text-neutral-900">{formatShortDate(demoCase.saleDateISO)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Borrower</dt>
            <dd className="font-medium text-neutral-900">{demoCase.borrowerName}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Original Principal</dt>
            <dd className="font-medium text-neutral-900">{formatMoney(demoCase.originalLoanCents)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-neutral-500">Legal Description</dt>
            <dd className="mt-1 font-medium text-neutral-900">{demoCase.legalDescription}</dd>
          </div>
        </dl>

        <p className="mt-8 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
          In production, this page shows the actual scanned county foreclosure notice this record was extracted from.
        </p>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return DEMO_HIDALGO_CASES.map((c) => ({ id: c.id }));
}
