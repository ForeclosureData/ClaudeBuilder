import Link from "next/link";

/** Subtle, not alarm-styled — legal disclosure without making the app feel like enterprise software. */
export function DisclaimerBanner() {
  return (
    <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-1.5 text-center text-xs text-neutral-400 dark:border-neutral-900 dark:bg-neutral-950 dark:text-neutral-500">
      Public-record data, may be incomplete or delayed. Not legal or investment advice.{" "}
      <Link href="/disclaimers" className="underline hover:text-neutral-600 dark:hover:text-neutral-300">Learn more</Link>
    </div>
  );
}
