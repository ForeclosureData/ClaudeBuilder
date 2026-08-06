import Link from "next/link";
import { CountySearch } from "@/components/search/county-search";

export default function LandingPage() {
  return (
    <div className="container-page flex flex-col items-center py-20 text-center sm:py-28">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-5xl">
        Every Texas Foreclosure.
        <br />
        Organized. Searchable.
      </h1>
      <p className="mt-4 max-w-md text-lg text-neutral-500 dark:text-neutral-400">
        AI reads every foreclosure notice so you don&rsquo;t have to.
      </p>

      <div className="mt-10 w-full">
        <CountySearch autoFocus size="lg" />
        <p className="mt-3 text-sm text-neutral-400">
          Try{" "}
          <Link href="/county/hidalgo-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Hidalgo County</Link>,{" "}
          <Link href="/county/dallas-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Dallas County</Link>, or{" "}
          <Link href="/county/bexar-tx" className="underline hover:text-neutral-600 dark:hover:text-neutral-200">Bexar County</Link>
        </p>
      </div>

      <p className="mt-16 text-xs uppercase tracking-wide text-neutral-400">No account needed to browse</p>
    </div>
  );
}
