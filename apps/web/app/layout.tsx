import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { DisclaimerBanner } from "@/components/layout/disclaimer-banner";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { ServiceWorkerRegister } from "@/components/layout/service-worker-register";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { DEMO_MODE } from "@/lib/demo/config";
import { DemoNavbar } from "@/components/demo/demo-navbar";
import { DemoFooter } from "@/components/demo/demo-footer";

export const metadata: Metadata = {
  title: "ForeclosureData — Every Texas Foreclosure. Organized. Searchable.",
  description: "AI reads every foreclosure notice so you don't have to. Search upcoming Texas foreclosure-sale properties, starting with Hidalgo County.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ForeclosureData",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Demo mode never calls getCurrentProfileId (Supabase) at all -- not just
  // because it already fails safe to null, but so this whole render path
  // has zero dependency on real auth infra being configured.
  const profileId = DEMO_MODE ? null : await getCurrentProfileId();

  if (DEMO_MODE) {
    return (
      <html lang="en">
        <body className="flex min-h-screen flex-col bg-white font-sans text-neutral-900">
          <DemoNavbar />
          <main className="flex-1">{children}</main>
          <DemoFooter />
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-white font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
        <DisclaimerBanner />
        <Navbar isAuthenticated={Boolean(profileId)} />
        <main className="flex-1 pb-16 sm:pb-0">{children}</main>
        <Footer />
        <MobileBottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
