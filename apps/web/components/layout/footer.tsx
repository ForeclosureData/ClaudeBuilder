import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 py-8 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="container-page flex flex-col gap-4 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} ForeclosureData. Information and research tool only — not legal or investment advice.</p>
        <div className="flex gap-4">
          <Link href="/disclaimers" className="hover:text-neutral-900 dark:hover:text-white">Disclaimers</Link>
          <Link href="/pricing" className="hover:text-neutral-900 dark:hover:text-white">Pricing</Link>
        </div>
      </div>
    </footer>
  );
}
