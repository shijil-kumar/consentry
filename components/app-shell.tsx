import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/sign-out-button";
import { NotificationBell } from "@/components/notification-bell";
import { NavLink } from "@/components/nav-link";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export function AppShell({
  role,
  displayName,
  children,
}: {
  role: "creator" | "buyer" | "admin" | "fan";
  displayName: string;
  children: React.ReactNode;
}) {
  const home = role === "creator" ? "/creator" : role === "buyer" ? "/buyer" : role === "fan" ? "/fan" : "/";
  const nav =
    role === "creator"
      ? [
          { href: "/creator", label: "Home" },
          { href: "/creator/requests", label: "Approvals" },
          { href: "/creator/protection", label: "Protection" },
          { href: "/creator/listing", label: "Listing" },
        ]
      : role === "buyer"
        ? [
            { href: "/buyer", label: "Home" },
            { href: "/marketplace", label: "Discover" },
            { href: "/celebrities", label: "Stars" },
            { href: "/buyer/campaign", label: "Generate" },
          ]
        : role === "fan"
          ? [
              { href: "/fan", label: "Feed" },
              { href: "/celebrities", label: "Discover" },
              { href: "/inspect", label: "Verify" },
            ]
          : [
              { href: "/admin", label: "Console" },
              { href: "/marketplace", label: "Marketplace" },
            ];
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link href={home} className="flex items-center gap-2 font-semibold tracking-tight">
              <LogoMark className="size-7" />
              {PLATFORM}
            </Link>
            <nav className="hidden items-center gap-4 sm:flex">
              {nav.map((n) => (
                <NavLink key={n.href} href={n.href} label={n.label} siblings={nav.map((x) => x.href)} />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Badge variant="outline" className="capitalize">{role === "creator" ? "celebrity" : role === "buyer" ? "brand" : role}</Badge>
            <span className="hidden text-sm text-muted-foreground sm:inline">{displayName}</span>
            <SignOutButton />
          </div>
        </div>

        {/* Mobile nav. Without this the entire signed-in app was unreachable
            below 640px — on a product whose core promise is "approve every
            video from your phone". A scroll strip beats a hamburger here:
            every destination stays visible and it needs no open/close state. */}
        <nav className="flex gap-1 overflow-x-auto border-t px-2 py-1.5 sm:hidden">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} label={n.label} siblings={nav.map((x) => x.href)} mobile />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
