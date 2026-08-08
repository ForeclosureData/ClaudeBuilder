import type { Metadata } from "next";
import { DemoSavedPropertiesProvider } from "@/lib/demo/saved-context";

export const metadata: Metadata = {
  title: "ForeclosureData — Investor Demo",
  description: "A demo preview of ForeclosureData using fixture data. Not connected to any live county source.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoSavedPropertiesProvider>{children}</DemoSavedPropertiesProvider>;
}
