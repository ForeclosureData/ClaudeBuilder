export function PropertyCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-3">
        <div className="w-2/3 space-y-2">
          <div className="h-5 w-4/5 rounded bg-neutral-200" />
          <div className="h-3.5 w-1/2 rounded bg-neutral-100" />
        </div>
        <div className="h-10 w-16 rounded-md bg-neutral-100" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-14 rounded bg-neutral-100" />
            <div className="h-4 w-16 rounded bg-neutral-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="h-7 w-16 rounded bg-neutral-200" />
      <div className="mt-2 h-3.5 w-24 rounded bg-neutral-100" />
    </div>
  );
}
