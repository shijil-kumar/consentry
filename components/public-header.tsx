import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { supabaseServer } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

// Shared header for the PUBLIC pages (/celebrities, /inspect, /marketplace,
// /actors, /request-a-star).
//
// These pages are linked from the signed-in nav, but each shipped its own
// hard-coded header pointing at "/" and offering "Sign in" — so a logged-in fan
// tapping their own "Verify" tab landed on a page that looked signed-out and
// gave them no way back. The nav became a one-way door.
//
// Now: if there's a session, the logo goes to THEIR home and we show an
// explicit way back. Signed-out visitors see the marketing CTAs as before.
export async function PublicHeader({
  children,
  width = "max-w-6xl",
}: {
  children?: React.ReactNode; // extra public links, shown to everyone
  width?: string;
}) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  let home: string | null = null;
  let label = "";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role;
    home = role === "creator" ? "/creator"
      : role === "buyer" ? "/buyer"
      : role === "admin" ? "/admin"
      : role === "fan" ? "/fan" : null;
    label = role === "creator" ? "My studio"
      : role === "buyer" ? "My dashboard"
      : role === "admin" ? "Console"
      : "My feed";
  }

  return (
    <header className={`mx-auto flex h-16 ${width} items-center justify-between px-5`}>
      <Link href={home ?? "/"} className="flex items-center gap-2 font-semibold tracking-tight">
        <LogoMark className="size-8" />
        {PLATFORM}
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {children}
        {home ? (
          <Button render={<Link href={home} />} nativeButton={false} size="sm" variant="outline"
            className="border-zinc-600 bg-transparent text-zinc-100 hover:bg-zinc-900 hover:text-white">
            <ArrowLeft className="size-3.5" /> {label}
          </Button>
        ) : (
          <>
            <Link href="/login" className="text-zinc-300 hover:text-white">Sign in</Link>
            <Button render={<Link href="/signup" />} nativeButton={false} size="sm"
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
              Get started
            </Button>
          </>
        )}
      </nav>
    </header>
  );
}
