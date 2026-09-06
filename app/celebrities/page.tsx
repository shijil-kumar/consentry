import Link from "next/link";
import Image from "next/image";
import { Fraunces } from "next/font/google";
import { supabaseServer } from "@/lib/supabase/server";
import { BadgeCheck, ShieldCheck, Users } from "lucide-react";
import { PublicHeader } from "@/components/public-header";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["400", "500", "600"] });
const display = "[font-family:var(--font-fraunces)]";

export const metadata = {
  title: "Celebrity directory",
  description: "Every verified AI likeness on the registry — protected, consent-anchored, and licensable.",
};
export const dynamic = "force-dynamic";

const FALLBACK_PORTRAIT = "/actors/a1.jpg";

export default async function CelebritiesPage() {
  const supabase = await supabaseServer();
  // Ordered explicitly: without it Postgres returns rows in arbitrary order and
  // the directory reshuffled between loads. creator_id comes straight from the
  // listing now, so Follow works for every star — not only those who already
  // have delivered content in the registry.
  const [{ data: listings }, { data: counts }] = await Promise.all([
    supabase.from("public_listings")
      .select("id, creator_id, display_name, handle, title, avatar_url, consent_verified, kyc_verified, is_demo, allowed_categories")
      .order("display_name"),
    supabase.from("public_follow_counts").select("celebrity_id, followers"),
  ]);
  const followerByCreator = new Map((counts ?? []).map((c) => [c.celebrity_id, c.followers]));

  return (
    <div className={`${fraunces.variable} min-h-dvh bg-zinc-950 text-zinc-100`}>
      <PublicHeader>
        <Link href="/request-a-star" className="text-zinc-300 hover:text-white">Request a star</Link>
        <Link href="/marketplace" className="hidden text-zinc-300 hover:text-white sm:block">For brands</Link>
      </PublicHeader>

      <main className="mx-auto max-w-6xl px-5 py-12">
        <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-emerald-400">The registry</p>
        <h1 className={`${display} mt-2 max-w-2xl text-3xl font-medium tracking-tight sm:text-5xl`}>
          Verified likenesses, on the record.
        </h1>
        <p className="mt-4 max-w-2xl text-zinc-300">
          Every page below is a canonical registry: consent anchored, identity checked, every
          authorised video listed. If it&apos;s not on their page, it wasn&apos;t approved.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(listings ?? []).map((l) => {
            const followers = followerByCreator.get(l.creator_id) ?? 0;
            return (
              <Link key={l.id} href={`/c/${l.handle}`}
                className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
                <div className="relative aspect-[4/3] bg-zinc-900">
                  <Image src={l.avatar_url ?? FALLBACK_PORTRAIT} alt={l.display_name} fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-zinc-950/90 to-transparent" />
                  {l.consent_verified && (
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-zinc-950/85 px-2.5 py-1 text-xs font-medium text-emerald-400">
                      <ShieldCheck className="size-3.5" /> Protected
                    </span>
                  )}
                  {l.is_demo && (
                    <span className="absolute right-3 top-3 rounded-full bg-zinc-950/85 px-2.5 py-1 text-xs font-medium text-amber-400">DEMO</span>
                  )}
                  <div className="absolute bottom-3 left-4 flex items-center gap-2">
                    <p className="text-lg font-semibold text-white">{l.display_name}</p>
                    {l.kyc_verified && <BadgeCheck className="size-4 text-sky-400" />}
                  </div>
                </div>
                <div className="flex items-center justify-between p-4">
                  <p className="truncate pr-2 text-sm text-zinc-400">{l.title}</p>
                  {followers > 0 && (
                    <p className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                      <Users className="size-3.5" /> {followers.toLocaleString("en-IN")}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        <p className="mt-10 text-sm text-zinc-400">
          Don&apos;t see your favourite star? <Link href="/request-a-star" className="font-medium text-emerald-400 hover:text-emerald-300">Vote to get them protected →</Link>
        </p>
      </main>
    </div>
  );
}
