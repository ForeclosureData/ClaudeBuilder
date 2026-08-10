"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Heart, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/county/hidalgo-tx", label: "Browse", icon: Search },
  { href: "/watchlist", label: "Saved", icon: Heart },
  { href: "/settings/billing", label: "Account", icon: User },
];

/** Mobile-only bottom tab bar — desktop uses the top nav instead. */
export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white/95 backdrop-blur sm:hidden dark:border-neutral-800 dark:bg-neutral-950/95">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs",
              active ? "text-brand-600 dark:text-brand-400" : "text-neutral-400",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
