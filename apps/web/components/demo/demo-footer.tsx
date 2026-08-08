import Link from "next/link";

export function DemoFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 py-10">
      <div className="container-page flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-900 text-xs font-bold text-white">FD</span>
            ForeclosureData
          </div>
          <p className="mt-2 max-w-sm text-sm text-neutral-500">
            County foreclosure notices, turned into searchable investment opportunities. Built for automated county monitoring, starting with Hidalgo County, TX.
          </p>
        </div>
        <div className="flex gap-10 text-sm">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-neutral-900">Product</span>
            <Link href="/demo/browse" className="text-neutral-500 hover:text-neutral-900">Browse</Link>
            <Link href="/demo/map" className="text-neutral-500 hover:text-neutral-900">Map</Link>
            <Link href="/demo/pricing" className="text-neutral-500 hover:text-neutral-900">Pricing</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-neutral-900">Company</span>
            <span className="text-neutral-500">foreclosuredata.net</span>
            <span className="text-neutral-400">Demo build — investor preview</span>
          </div>
        </div>
      </div>
      <div className="container-page mt-8 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
        This is a demo build using fixture data for illustration. Not connected to any live county source. Not legal or investment advice.
      </div>
    </footer>
  );
}
