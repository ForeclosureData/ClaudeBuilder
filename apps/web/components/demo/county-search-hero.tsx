"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CountySearchHero() {
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push("/demo/browse");
      }}
      className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex flex-1 items-center gap-2 px-2">
        <Search className="h-4 w-4 shrink-0 text-neutral-400" />
        <Select defaultValue="hidalgo" className="h-11 border-0 shadow-none focus:ring-0" aria-label="Search a county">
          <option value="hidalgo">Hidalgo County, TX</option>
        </Select>
      </div>
      <Button type="submit" size="lg" className="w-full sm:w-auto">
        Browse Foreclosures
      </Button>
    </form>
  );
}
