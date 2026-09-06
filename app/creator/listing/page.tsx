import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import {
  ListingEditor, type ClauseOption, type ListingDraft, type TierDraft,
} from "@/components/listing-editor";

export const metadata = { title: "Listing editor" };

export default async function ListingPage() {
  const { supabase, profile } = await requireProfile("creator");

  const [{ data: avatars }, { data: listings }, { data: clauses }] = await Promise.all([
    supabase.from("avatars").select("id, status")
      .eq("org_id", profile.org_id)
      .order("created_at", { ascending: false }).limit(1),
    // MUST filter by org: listings_select deliberately exposes every PUBLISHED
    // listing to any authenticated user (the marketplace needs that), so an
    // unscoped "latest listing" query returned ANOTHER creator's listing into
    // this editor — and saving then hit RLS errors against a foreign row.
    supabase.from("listings")
      .select("id, title, bio, allowed_categories, status")
      .eq("org_id", profile.org_id)
      .order("created_at", { ascending: false }).limit(1),
    supabase.from("policy_clauses")
      .select("id, code, title, description, default_on")
      .eq("is_platform", false).order("sort_order").returns<ClauseOption[]>(),
  ]);

  const avatar = avatars?.[0] ?? null;
  const listingRow = listings?.[0] ?? null;

  let tiers: TierDraft[] = [];
  let selected: Record<string, string | null> = {};
  if (listingRow) {
    const [{ data: tierRows }, { data: lpu }] = await Promise.all([
      supabase.from("license_tiers")
        .select("id, name, price_paise, duration_days, max_generations, exclusivity, sort_order")
        .eq("listing_id", listingRow.id).order("sort_order"),
      supabase.from("listing_prohibited_uses")
        .select("clause_id, custom_note").eq("listing_id", listingRow.id),
    ]);
    tiers = (tierRows ?? []).map((t) => ({
      id: t.id, name: t.name, price_inr: Math.round(t.price_paise / 100),
      duration_days: t.duration_days, max_generations: t.max_generations,
      exclusivity: t.exclusivity, sort_order: t.sort_order,
    }));
    selected = Object.fromEntries((lpu ?? []).map((r) => [r.clause_id, r.custom_note]));
  }

  const initialListing: ListingDraft | null = listingRow
    ? {
        id: listingRow.id, title: listingRow.title, bio: listingRow.bio ?? "",
        allowed_categories: listingRow.allowed_categories, status: listingRow.status,
      }
    : null;

  return (
    <AppShell role="creator" displayName={profile.display_name}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Marketplace listing</h1>
          <p className="text-sm text-muted-foreground">
            Your rules are public — buyers see exactly what you will and won&apos;t endorse
            before they write a script.
          </p>
        </div>
        <ListingEditor
          orgId={profile.org_id}
          creatorId={profile.id}
          avatarId={avatar?.id ?? null}
          avatarReady={avatar?.status === "ready"}
          initialListing={initialListing}
          initialTiers={tiers}
          clauses={clauses ?? []}
          initialSelected={selected}
        />
      </div>
    </AppShell>
  );
}
