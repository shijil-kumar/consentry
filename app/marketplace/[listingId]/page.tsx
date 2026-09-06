import Link from "next/link";
import Image from "next/image";
import { LogoMark } from "@/components/logo";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BadgeCheck, Ban, ScrollText } from "lucide-react";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";
export const dynamic = "force-dynamic";

interface Tier {
  id: string; name: string; price_paise: number; duration_days: number;
  exclusivity: "none" | "category" | "full"; max_generations: number; sort_order: number;
}
interface Rule { code: string; title: string; description: string; custom_note: string | null }

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default async function CreatorDetail({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  const supabase = await supabaseServer();

  const [{ data: listing }, { data: tiers }, { data: rules }] = await Promise.all([
    supabase.from("public_listings").select("*").eq("id", listingId).maybeSingle(),
    supabase.from("public_listing_tiers").select("*").eq("listing_id", listingId)
      .order("sort_order").returns<Tier[]>(),
    supabase.from("public_listing_rules").select("*").eq("listing_id", listingId)
      .order("code").returns<Rule[]>(),
  ]);
  if (!listing) notFound();

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <LogoMark className="size-8" />
          {PLATFORM}
        </Link>
        <Button render={<Link href="/login" />} nativeButton={false} variant="ghost"
          className="text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50">
          Sign in
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> All creators
        </Link>

        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
              {/* Photo before initial. The creator's avatar_url was populated all
                  along but never rendered here, so the most important page in the
                  buying flow showed a grey letter where the person should be —
                  the same bug the marketplace grid had. */}
              <div className="relative aspect-video">
                {listing.preview_video_url ? (
                  <video src={listing.preview_video_url} controls playsInline className="h-full w-full object-cover" />
                ) : listing.avatar_url ? (
                  <Image
                    src={listing.avatar_url} alt={listing.display_name} fill
                    sizes="(max-width: 1024px) 100vw, 55vw"
                    className="object-cover" priority
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-950 text-7xl font-semibold text-zinc-600">
                    {listing.display_name.slice(0, 1)}
                  </div>
                )}
              </div>
              {listing.consent_verified && (
                <Badge className="absolute left-4 top-4 border-emerald-500/40 bg-zinc-950/85 text-emerald-400">
                  <BadgeCheck className="size-3.5" /> Consent verified
                  {listing.consent_verified_at &&
                    ` · ${new Date(listing.consent_verified_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                </Badge>
              )}
            </div>

            <h1 className="mt-6 text-3xl font-semibold tracking-tight">{listing.display_name}</h1>
            <p className="mt-1 text-zinc-400">{listing.title}</p>
            {listing.bio && <p className="mt-4 text-sm leading-relaxed text-zinc-300">{listing.bio}</p>}

            <div className="mt-4 flex flex-wrap gap-1.5">
              {listing.allowed_categories.map((c: string) => (
                <span key={c} className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs capitalize text-zinc-300">
                  {c}
                </span>
              ))}
            </div>

            <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <Ban className="size-4 text-red-400" /> This creator will not endorse
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Scripts are checked against these rules before any payment. Platform-wide
                rules (political content, health misinformation, fraud, adult content,
                minors) always apply on top.
              </p>
              {rules && rules.length > 0 ? (
                <ul className="mt-4 space-y-2.5">
                  {rules.map((r) => (
                    <li key={r.code} className="text-sm">
                      <span className="mr-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-400">{r.code}</span>
                      <span className="font-medium text-zinc-200">{r.title}</span>
                      <span className="text-zinc-400"> — {r.description}</span>
                      {r.custom_note && <span className="text-zinc-500"> ({r.custom_note})</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">Only the platform-wide rules apply.</p>
              )}
            </section>
          </div>

          <aside>
            <h2 className="flex items-center gap-2 font-medium">
              <ScrollText className="size-4 text-emerald-400" /> Licensing tiers
            </h2>
            <div className="mt-4 space-y-4">
              {(tiers ?? []).map((t) => (
                <div key={t.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium text-zinc-100">{t.name}</h3>
                    <span className="text-xl font-semibold text-emerald-400">{inr(t.price_paise)}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    {t.duration_days}-day license · {t.max_generations} video{t.max_generations > 1 ? "s" : ""}
                    {t.exclusivity !== "none" && ` · ${t.exclusivity} exclusivity`}
                  </p>
                  <Button
                    render={<Link href={`/marketplace/${listingId}/request?tier=${t.id}`} />}
                    nativeButton={false}
                    className="mt-4 w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                  >
                    Submit a script
                  </Button>
                </div>
              ))}
              {(!tiers || tiers.length === 0) && (
                <p className="text-sm text-zinc-500">No tiers published.</p>
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">
              Your script is approved against the creator&apos;s rules BEFORE you pay.
              Rejected scripts cost nothing. Payments run in test mode during the pilot.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
