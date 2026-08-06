import Link from "next/link";
import { Map, Heart, Bell, User } from "lucide-react";

const navItems = [
  { href: "/properties", label: "My Counties", icon: Map },
  { href: "/watchlist", label: "Saved Properties", icon: Heart },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings/billing", label: "Account", icon: User },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page flex gap-8 py-8">
      <aside className="hidden w-48 shrink-0 md:block">
        <nav className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
