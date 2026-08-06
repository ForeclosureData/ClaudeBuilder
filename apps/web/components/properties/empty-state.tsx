import { SearchX } from "lucide-react";

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <SearchX className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
      <p className="font-medium text-neutral-700 dark:text-neutral-300">{message}</p>
      {hint && <p className="text-sm text-neutral-400">{hint}</p>}
    </div>
  );
}
