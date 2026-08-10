import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Navbar({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="container-page flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          <span className="rounded-md bg-brand-600 px-2 py-0.5 text-sm text-white">FD</span>
          ForeclosureData
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-neutral-600 dark:text-neutral-300 sm:flex">
          <Link href="/county/hidalgo-tx" className="hover:text-neutral-900 dark:hover:text-white">Browse</Link>
          <Link href="/county/hidalgo-tx?view=map" className="hover:text-neutral-900 dark:hover:text-white">Map</Link>
          <Link href="/watchlist" className="hover:text-neutral-900 dark:hover:text-white">Saved</Link>
          <Link href="/pricing" className="hover:text-neutral-900 dark:hover:text-white">Pricing</Link>
        </nav>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Link href="/settings/billing">
              <Button size="sm">Account</Button>
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="hidden sm:block">
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link href="/sign-up">
                <Button size="sm">Start Free Trial</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
