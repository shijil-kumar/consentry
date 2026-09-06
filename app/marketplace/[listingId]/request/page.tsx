import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ScriptRequestForm } from "@/components/script-request-form";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Submit a script" };

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default async function RequestPage({
  params, searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ tier?: string; draft?: string }>;
}) {
  const { listingId } = await params;
  const { tier: tierId, draft } = await searchParams;
  const { supabase, profile } = await requireProfile();
  if (profile.role !== "buyer") redirect("/creator"); // creators don't buy their own likeness

  const [{ data: listing }, { data: tiers }, { data: rules }] = await Promise.all([
    supabase.from("public_listings").select("*").eq("id", listingId).maybeSingle(),
    supabase.from("public_listing_tiers").select("*").eq("listing_id", listingId).order("sort_order"),
    supabase.from("public_listing_rules").select("code, title").eq("listing_id", listingId).order("code"),
  ]);
  if (!listing) notFound();
  const tier = (tiers ?? []).find((t) => t.id === tierId) ?? (tiers ?? [])[0];
  if (!tier) notFound();

  return (
    <AppShell role="buyer" displayName={profile.display_name}>
      <div className="mx-auto max-w-2xl">
        {/* A breadcrumb, not a bare back-arrow. The single "← Arjun Menon" link
            read as "go back" but landed on the listing page, which is not where
            most people came from — they came from the marketplace. Showing the
            whole trail removes the guesswork about where any link goes. */}
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/marketplace" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-4" /> Marketplace
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/marketplace/${listingId}`} className="hover:text-foreground">
            {listing.display_name}
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground">Submit your script</span>
        </nav>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Submit your script</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listing.display_name} · <span className="font-medium text-foreground">{tier.name}</span> — {inr(tier.price_paise)} ·{" "}
            {tier.duration_days} days · {tier.max_generations} video{tier.max_generations > 1 ? "s" : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {/* Data-driven, not decorative: this badge used to be hardcoded
                green, so a listing whose consent is NOT verified still claimed
                "Consent verified" on the page where the brand pays. */}
            {listing.consent_verified ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                <BadgeCheck className="size-3.5" /> Consent verified
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">
                Consent pending — not licensable yet
              </Badge>
            )}
            {(rules ?? []).map((r) => (
              <span key={r.code} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {r.code} {r.title}
              </span>
            ))}
          </div>
        </div>

        <ScriptRequestForm
          listingId={listingId}
          tierId={tier.id}
          tierName={tier.name}
          allowedCategories={listing.allowed_categories}
          initialScript={draft ? draft.slice(0, 2000) : undefined}
        />
      </div>
    </AppShell>
  );
}
