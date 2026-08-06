"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

interface CountyOption {
  slug: string;
  name: string;
}

export function PropertyFilters({ counties }: { counties: CountyOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [values, setValues] = useState({
    countySlug: searchParams.get("countySlug") ?? "",
    city: searchParams.get("city") ?? "",
    zipCode: searchParams.get("zipCode") ?? "",
    propertyType: searchParams.get("propertyType") ?? "",
    classification: searchParams.get("classification") ?? "",
    borrowerSearch: searchParams.get("borrowerSearch") ?? "",
    lenderSearch: searchParams.get("lenderSearch") ?? "",
    saleDateFrom: searchParams.get("saleDateFrom") ?? "",
    saleDateTo: searchParams.get("saleDateTo") ?? "",
    manualReviewStatus: searchParams.get("manualReviewStatus") ?? "",
    savedOnly: searchParams.get("savedOnly") ?? "",
  });

  function update(key: string, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div>
        <Label>County</Label>
        <Select value={values.countySlug} onChange={(e) => update("countySlug", e.target.value)}>
          <option value="">All counties</option>
          {counties.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label>City</Label>
        <Input value={values.city} onChange={(e) => update("city", e.target.value)} placeholder="e.g. McAllen" />
      </div>
      <div>
        <Label>ZIP code</Label>
        <Input value={values.zipCode} onChange={(e) => update("zipCode", e.target.value)} placeholder="78501" />
      </div>
      <div>
        <Label>Property type</Label>
        <Select value={values.classification} onChange={(e) => update("classification", e.target.value)}>
          <option value="">Any</option>
          <option value="RESIDENTIAL">Residential</option>
          <option value="COMMERCIAL">Commercial</option>
        </Select>
      </div>
      <div>
        <Label>Sale date from</Label>
        <Input type="date" value={values.saleDateFrom} onChange={(e) => update("saleDateFrom", e.target.value)} />
      </div>
      <div>
        <Label>Sale date to</Label>
        <Input type="date" value={values.saleDateTo} onChange={(e) => update("saleDateTo", e.target.value)} />
      </div>
      <div>
        <Label>Borrower / owner</Label>
        <Input value={values.borrowerSearch} onChange={(e) => update("borrowerSearch", e.target.value)} placeholder="Search name" />
      </div>
      <div>
        <Label>Lender</Label>
        <Input value={values.lenderSearch} onChange={(e) => update("lenderSearch", e.target.value)} placeholder="Search lender" />
      </div>
      <div>
        <Label>Review status</Label>
        <Select value={values.manualReviewStatus} onChange={(e) => update("manualReviewStatus", e.target.value)}>
          <option value="">Any</option>
          <option value="NOT_NEEDED">No review needed</option>
          <option value="PENDING">Pending review</option>
          <option value="RESOLVED">Resolved</option>
        </Select>
      </div>
      <div>
        <Label>Saved only</Label>
        <Select value={values.savedOnly} onChange={(e) => update("savedOnly", e.target.value)}>
          <option value="">All properties</option>
          <option value="true">Saved only</option>
        </Select>
      </div>
      <div className="flex items-end">
        <Button variant="outline" onClick={() => router.push(pathname)}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}
