import type { Metadata } from "next";
import { SavedPropertiesView } from "@/components/demo/saved-properties-view";
import { DEMO_HIDALGO_CASES } from "@/lib/demo/fixtures/hidalgo-demo-cases";

export const metadata: Metadata = { title: "Saved Properties — ForeclosureData Demo" };

export default function DemoSavedPage() {
  return <SavedPropertiesView cases={DEMO_HIDALGO_CASES} />;
}
