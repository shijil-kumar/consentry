"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BadgeCheck, Search } from "lucide-react";

export interface GridListing {
  id: string;
  title: string;
  display_name: string;
  allowed_categories: string[];
  preview_video_url: string | null;
  avatar_url: string | null;
  consent_verified: boolean;
  from_price_paise: number | null;
  is_demo?: boolean;
  kyc_verified?: boolean;
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function MarketplaceGrid({ listings }: { listings: GridListing[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<"relevance" | "price_asc" | "price_desc">("relevance");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const categories = useMemo(
    () => [...new Set(listings.flatMap((l) => l.allowed_categories))].sort(),
    [listings],
  );

  const filtered = useMemo(() => {
    let out = listings.filter((l) => {
      const matchesQ =
        !q ||
        l.display_name.toLowerCase().includes(q.toLowerCase()) ||
        l.title.toLowerCase().includes(q.toLowerCase()) ||
        l.allowed_categories.some((c) => c.includes(q.toLowerCase()));
      const matchesCat = !cat || l.allowed_categories.includes(cat);
      const matchesVerified = !verifiedOnly || l.consent_verified;
      return matchesQ && matchesCat && matchesVerified;
    });
    if (sort === "price_asc") out = [...out].sort((a, b) => (a.from_price_paise ?? 1e12) - (b.from_price_paise ?? 1e12));
    if (sort === "price_desc") out = [...out].sort((a, b) => (b.from_price_paise ?? 0) - (a.from_price_paise ?? 0));
    return out;
  }, [listings, q, cat, sort, verifiedOnly]);

  return (
    <>
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search creators or categories…"
            className="border-zinc-800 bg-zinc-900/60 pl-9 text-zinc-100 placeholder:text-zinc-500" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 text-sm text-zinc-200">
          <option value="relevance">Sort: Relevance</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
        </select>
        <button onClick={() => setVerifiedOnly(!verifiedOnly)}
          aria-pressed={verifiedOnly}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${verifiedOnly ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"}`}>
          <BadgeCheck className="size-4" /> Verified only
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => setCat(null)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${!cat ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-900"}`}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} onClick={() => setCat(cat === c ? null : c)}
            className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${cat === c ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-900"}`}>
            {c}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-zinc-500">
        {filtered.length} creator{filtered.length === 1 ? "" : "s"}
        {verifiedOnly && " · consent-verified"}
        {cat && ` · ${cat}`}
      </p>

      {filtered.length > 0 ? (
        <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <Link key={l.id} href={`/marketplace/${l.id}`}
              className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
              <div className="relative aspect-[4/3] bg-zinc-900">
                {/* Video first, then the PHOTO, and only then a letter. The photo
                    step was missing, so every card fell back to a grey initial even
                    though avatar_url is set for all six creators — the registry and
                    the actor library were showing faces while the marketplace, the
                    page a brand actually shops on, showed placeholders. */}
                {l.preview_video_url ? (
                  <video src={l.preview_video_url} muted playsInline className="h-full w-full object-cover" />
                ) : l.avatar_url ? (
                  <Image src={l.avatar_url} alt={l.display_name} fill sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-950 text-4xl font-semibold text-zinc-600">
                    {l.display_name.slice(0, 1)}
                  </div>
                )}
                {l.consent_verified ? (
                  <Badge className="absolute left-3 top-3 border-emerald-500/40 bg-zinc-950/85 text-emerald-400">
                    <BadgeCheck className="size-3.5" /> Consent verified
                  </Badge>
                ) : (
                  <Badge className="absolute left-3 top-3 border-zinc-600/60 bg-zinc-950/85 text-zinc-400">
                    Consent pending
                  </Badge>
                )}
                {l.is_demo && (
                  <Badge className="absolute right-3 top-3 border-amber-500/40 bg-zinc-950/85 text-amber-400">
                    DEMO
                  </Badge>
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 font-medium text-zinc-100 group-hover:text-emerald-300">
                    {l.display_name}
                    {l.kyc_verified && <BadgeCheck className="size-4 shrink-0 text-sky-400" aria-label="Identity verified" />}
                  </h2>
                  {l.from_price_paise !== null && (
                    <span className="shrink-0 text-sm text-zinc-400">from <span className="font-medium text-zinc-200">{inr(l.from_price_paise)}</span></span>
                  )}
                </div>
                <p className="line-clamp-2 text-sm text-zinc-400">{l.title}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {l.allowed_categories.slice(0, 4).map((c) => (
                    <span key={c} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs capitalize text-zinc-400">{c}</span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-16 rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500">
          No creators match your search.
        </div>
      )}
    </>
  );
}
