"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./CurrentUser";

const links = [
  { href: "/browse", label: "Browse" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

export function AppNav() {
  const me = useMe();
  const pathname = usePathname();
  // Showing the admin tab is cosmetic; admin functions re-check the role.
  const items = me.role === "admin" ? [...links, { href: "/admin", label: "Admin" }] : links;
  return (
    <nav aria-label="Main" className="-mx-1 mb-8 flex gap-1 overflow-x-auto border-b border-stone-200">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
              active ? "border-emerald-700 text-emerald-800" : "border-transparent text-stone-600 hover:text-stone-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
