import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { MarketplaceGrid, type GridListing } from "@/components/marketplace-grid";
import { ArrowLeft } from "lucide-react";
import { PublicHeader } from "@/components/public-header";

export const metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

interface PublicListing {
  id: string;
  title: string;
  bio: string | null;
  allowed_categories: string[];
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  preview_video_url: string | null;
  consent_verified: boolean;
  consent_verified_at: string | null;
  is_demo: boolean;
  kyc_verified: boolean;
}
interface PublicTier { listing_id: string; price_paise: number; sort_order: number }

export default async function MarketplacePage() {
  const supabase = await supabaseServer();
  const [{ data: listings }, { data: tiers }] = await Promise.all([
    supabase.from("public_listings").select("*").returns<PublicListing[]>(),
    supabase.from("public_listing_tiers")
      .select("listing_id, price_paise, sort_order").returns<PublicTier[]>(),
  ]);

  const fromPrice = (id: string) => {
    const prices = (tiers ?? []).filter((t) => t.listing_id === id).map((t) => t.price_paise);
    return prices.length ? Math.min(...prices) : null;
  };

  const gridListings: GridListing[] = (listings ?? []).map((l) => ({
    id: l.id, title: l.title, display_name: l.display_name,
    allowed_categories: l.allowed_categories, preview_video_url: l.preview_video_url,
    avatar_url: l.avatar_url,
    consent_verified: l.consent_verified, from_price_paise: fromPrice(l.id),
    is_demo: l.is_demo, kyc_verified: l.kyc_verified,
  }));

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <PublicHeader>
        <Link href="/actors" className="text-zinc-300 hover:text-white">Actor Library</Link>
        <Link href="/inspect" className="hidden text-zinc-300 hover:text-white sm:block">Verify a video</Link>
      </PublicHeader>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Verified creators</h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Every listing carries an on-record, revocable consent grant. Rules are public —
          you know what a creator will and won&apos;t endorse before you write a script.
        </p>

        {gridListings.length > 0 ? (
          <MarketplaceGrid listings={gridListings} />
        ) : (
          <div className="mt-16 rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500">
            No published creators yet — the first verified listings land here.
          </div>
        )}
      </main>
    </div>
  );
}
