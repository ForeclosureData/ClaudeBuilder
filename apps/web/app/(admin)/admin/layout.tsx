import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@foreclosuredata/database";
import { getCurrentProfileId } from "@/lib/supabase/server";

const navItems = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/sources", label: "County sources" },
  { href: "/admin/review-queue", label: "Review queue" },
  { href: "/admin/property-resolution", label: "Property resolution" },
  { href: "/admin/corrections", label: "Corrections" },
];

/**
 * Middleware does a cheap edge-level check on the JWT claim, but the real
 * authorization boundary is here: every admin request re-verifies the
 * profile's role against Postgres before rendering anything sensitive.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profileId = await getCurrentProfileId();
  if (!profileId) redirect("/sign-in");

  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile || profile.role !== "ADMIN") redirect("/properties");

  return (
    <div className="container-page flex gap-8 py-8">
      <aside className="hidden w-48 shrink-0 md:block">
        <nav className="space-y-1">
          {navItems.map(({ href, label }) => (
            <Link key={href} href={href} className="block rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
