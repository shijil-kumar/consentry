"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Nav item that knows whether it is the current section. Previously no role had
// any active indicator, so you could never tell where you were.
export function NavLink({ href, label, siblings, mobile = false }: {
  href: string;
  label: string;
  /** Every href in this nav. Needed so the most specific item wins. */
  siblings?: string[];
  mobile?: boolean;
}) {
  const pathname = usePathname();
  // Exact match, or a child route — but only when no MORE SPECIFIC nav item
  // also matches. The previous version lit up every ancestor, so on
  // /creator/protection both "Home" (/creator) and "Protection" showed as the
  // current page. A path-boundary check alone does not fix that: "/creator/"
  // is still a prefix of "/creator/protection". Longest match wins.
  const isPrefix = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const best = (siblings ?? [href])
    .filter(isPrefix)
    .reduce((a, b) => (b.length > a.length ? b : a), "");
  const active = isPrefix(href) && best === href;

  if (mobile) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`text-sm transition-colors ${
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
