import Link from "next/link";
import Image from "next/image";
import { supabaseServer } from "@/lib/supabase/server";
import { ACTOR_LIBRARY } from "@/lib/actor-library";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, IndianRupee, Languages, ArrowRight } from "lucide-react";
import { PublicHeader } from "@/components/public-header";


export const metadata = {
  title: "Actor Library",
  description:
    "Consent-verified AI actors at flat per-video prices — script checked, provenance sealed, and the actor earns a royalty on every use.",
};

export default async function ActorLibraryPage() {
  // Demo wiring: each library actor routes to a live seeded listing so the
  // full script-gate → pay → deliver loop works end to end.
  const supabase = await supabaseServer();
  const [{ data: listings }, { data: tiers }, { data: takeRateBps }] = await Promise.all([
    supabase.from("public_listings").select("id, handle"),
    supabase.from("public_listing_tiers").select("listing_id, price_paise"),
    // The PUBLISHED platform rate. Competitor research (2026-08-01): Cameo's
    // opaque 25%+Apple-30% stacking is tied by coverage to its talent exodus,
    // and UGC platforms bury their cut entirely. Publishing the number — read
    // from the same setting the payout math uses — is itself the feature.
    supabase.rpc("public_take_rate_bps"),
  ]);
  const keepPct = 100 - (Number(takeRateBps ?? 1500) / 100);
  const byHandle = new Map((listings ?? []).map((l) => [l.handle, l.id]));
  // Price the card off the LIVE cheapest tier. The hardcoded card prices were
  // a fraction of the real minimum, so "Use this actor" jumped from the
  // advertised figure to ~4x on the very next screen.
  const minPriceByListing = new Map<string, number>();
  for (const t of tiers ?? []) {
    const cur = minPriceByListing.get(t.listing_id);
    if (cur === undefined || t.price_paise < cur) minPriceByListing.set(t.listing_id, t.price_paise);
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicHeader>
        <Link href="/marketplace" className="text-zinc-300 hover:text-white">Marketplace</Link>
        <Link href="/inspect" className="hidden text-zinc-300 hover:text-white sm:block">Verify a video</Link>
      </PublicHeader>

      <main className="mx-auto max-w-6xl px-5 py-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-emerald-400">Actor Library</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Ready-to-use AI actors. Flat prices. <span className="text-emerald-400">Real royalties.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-zinc-300">
          Every actor here consented on camera, passed deepfake screening, and set their own
          red lines. Pick one, write your script, and get a sealed, labelled ad — usually the
          same day. Unlike stock-actor tools, <span className="font-medium text-zinc-100">the
          actor earns a royalty on every video</span> you make with them.
        </p>
        <p className="mt-3 inline-flex flex-wrap items-center gap-x-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-2 text-sm text-zinc-300">
          <span className="font-semibold text-emerald-400">Actors keep {keepPct}%</span>
          <span aria-hidden>·</span> the {Number(takeRateBps ?? 1500) / 100}% platform rate is published, and the payout
          ledger uses this exact number
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ACTOR_LIBRARY.map((a) => {
            const listingId = byHandle.get(a.mappedHandle);
            const livePrice = listingId ? minPriceByListing.get(listingId) : undefined;
            const shownPaise = livePrice ?? a.pricePaise;
            return (
              <div key={a.slug}
                className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
                <div className="relative aspect-square bg-zinc-900">
                  <Image src={a.portrait} alt={`${a.name} — AI actor`} fill sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950/90 to-transparent" />
                  <Badge className="absolute left-3 top-3 border-emerald-500/40 bg-zinc-950/85 text-emerald-400">
                    <BadgeCheck className="size-3.5" /> Consent verified
                  </Badge>
                  <Badge className="absolute right-3 top-3 border-amber-500/40 bg-zinc-950/85 text-amber-400">
                    DEMO
                  </Badge>
                  <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                    <p className="text-lg font-semibold text-white">{a.name}</p>
                    <p className="flex items-center text-sm font-semibold text-emerald-300">
                      <IndianRupee className="size-3.5" />{(shownPaise / 100).toLocaleString("en-IN")}<span className="ml-0.5 font-normal text-zinc-400">/video</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-sm leading-relaxed text-zinc-300">{a.persona}</p>
                  <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Languages className="size-3.5" /> {a.languages.join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.categories.map((c) => (
                      <span key={c} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs capitalize text-zinc-400">{c}</span>
                    ))}
                  </div>
                  {listingId ? (
                    <Link href={`/marketplace/${listingId}`}
                      className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400">
                      Use this actor <ArrowRight className="size-4" />
                    </Link>
                  ) : (
                    <p className="text-xs text-zinc-500">Available soon</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-10 max-w-2xl text-xs leading-relaxed text-zinc-400">
          Want a specific audience? The <Link href="/marketplace" className="text-emerald-400 hover:text-emerald-300">creator
          marketplace</Link> lists creators with their own followings and premium tiers. Library actors are for
          speed and volume; marketplace creators are for reach.
        </p>
      </main>
    </div>
  );
}
