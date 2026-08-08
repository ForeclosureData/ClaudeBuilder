import type { Metadata } from "next";
import { BrowseView } from "@/components/demo/browse-view";
import { DEMO_HIDALGO_CASES, DEMO_COUNTY_SUMMARY } from "@/lib/demo/fixtures/hidalgo-demo-cases";

export const metadata: Metadata = { title: "Browse Foreclosures — ForeclosureData Demo" };

export default function DemoBrowsePage() {
  return <BrowseView cases={DEMO_HIDALGO_CASES} summary={DEMO_COUNTY_SUMMARY} initialView="list" />;
}
