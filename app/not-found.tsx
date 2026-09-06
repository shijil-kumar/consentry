import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Compass } from "lucide-react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export const metadata = { title: "Page not found" };

// Branded 404. The default was Next.js's stock white screen with no way out —
// reachable from any mistyped or stale link, including a shared /c/<handle>
// whose star has since changed their handle.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <LogoMark className="size-8" /> {PLATFORM}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-5 px-5 pb-24 text-center">
        <Compass className="size-10 text-emerald-400" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          We couldn&apos;t find that page
        </h1>
        <p className="text-pretty leading-relaxed text-zinc-400">
          The link may be old, or the address may have a typo. Everything below still works.
        </p>

        <nav className="mt-1 grid w-full gap-2 sm:grid-cols-2">
          {[
            { href: "/celebrities", label: "Verified stars", hint: "Who's protected" },
            { href: "/inspect", label: "Verify a video", hint: "Check any clip" },
            { href: "/marketplace", label: "For brands", hint: "License a likeness" },
            { href: "/", label: "Home", hint: "Start over" },
          ].map((l) => (
            <Link key={l.href} href={l.href}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900">
              <span className="block text-sm font-medium text-zinc-100">{l.label}</span>
              <span className="block text-xs text-zinc-400">{l.hint}</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
