"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Loader2, Plus, Trash2, Globe2, Save, ExternalLink } from "lucide-react";

export const CATEGORIES = [
  "fashion", "fitness", "tech", "beauty", "food", "travel", "home", "education", "gaming", "finance",
] as const;

export interface TierDraft {
  id?: string;
  name: string;
  price_inr: number;
  duration_days: number;
  max_generations: number;
  exclusivity: "none" | "category" | "full";
  sort_order: number;
}
export interface ClauseOption {
  id: string; code: string; title: string; description: string; default_on: boolean;
}
export interface ListingDraft {
  id?: string;
  title: string;
  bio: string;
  allowed_categories: string[];
  status: "draft" | "published" | "suspended";
}

const DEFAULT_TIERS: TierDraft[] = [
  { name: "Single Ad", price_inr: 4999, duration_days: 7, max_generations: 1, exclusivity: "none", sort_order: 1 },
  { name: "30-Day Campaign", price_inr: 14999, duration_days: 30, max_generations: 4, exclusivity: "none", sort_order: 2 },
  { name: "Exclusive", price_inr: 49999, duration_days: 30, max_generations: 10, exclusivity: "category", sort_order: 3 },
];

export function ListingEditor({
  orgId, creatorId, avatarId, avatarReady,
  initialListing, initialTiers, clauses, initialSelected,
}: {
  orgId: string;
  creatorId: string;
  avatarId: string | null;
  avatarReady: boolean;
  initialListing: ListingDraft | null;
  initialTiers: TierDraft[];
  clauses: ClauseOption[];
  initialSelected: Record<string, string | null>; // clause_id -> custom_note
}) {
  const router = useRouter();
  const [listing, setListing] = useState<ListingDraft>(
    initialListing ?? { title: "", bio: "", allowed_categories: ["tech", "fitness"], status: "draft" },
  );
  const [tiers, setTiers] = useState<TierDraft[]>(
    initialTiers.length ? initialTiers : DEFAULT_TIERS,
  );
  const [selected, setSelected] = useState<Record<string, string | null>>(
    Object.keys(initialSelected).length
      ? initialSelected
      : Object.fromEntries(clauses.filter((c) => c.default_on).map((c) => [c.id, null])),
  );
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const toggleCategory = (c: string) =>
    setListing((l) => ({
      ...l,
      allowed_categories: l.allowed_categories.includes(c)
        ? l.allowed_categories.filter((x) => x !== c)
        : [...l.allowed_categories, c],
    }));

  const toggleClause = (id: string) =>
    setSelected((s) => {
      const next = { ...s };
      if (id in next) delete next[id];
      else next[id] = null;
      return next;
    });

  async function persist(): Promise<string> {
    const supabase = supabaseBrowser();
    if (!avatarId) throw new Error("Train your replica first — the listing needs an avatar.");
    if (!listing.title.trim()) throw new Error("Give the listing a title.");
    if (listing.allowed_categories.length === 0) throw new Error("Pick at least 1 allowed category.");

    let listingId = listing.id;
    if (listingId) {
      const { error } = await supabase.from("listings")
        .update({ title: listing.title.trim(), bio: listing.bio.trim() || null, allowed_categories: listing.allowed_categories })
        .eq("id", listingId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("listings")
        .insert({
          org_id: orgId, creator_id: creatorId, avatar_id: avatarId,
          title: listing.title.trim(), bio: listing.bio.trim() || null,
          allowed_categories: listing.allowed_categories,
        })
        .select("id").single();
      if (error) throw error;
      listingId = data!.id;
      setListing((l) => ({ ...l, id: listingId }));
    }

    // Tiers: upsert edits, insert new, delete removed. Build a fresh array
    // (never mutate state in place).
    const savedTiers: TierDraft[] = [];
    for (let idx = 0; idx < tiers.length; idx++) {
      const t = tiers[idx];
      const row = {
        org_id: orgId, listing_id: listingId, name: t.name.trim() || "Tier",
        price_paise: Math.max(1, Math.round(t.price_inr * 100)),
        duration_days: Math.max(1, t.duration_days),
        max_generations: Math.max(1, t.max_generations),
        exclusivity: t.exclusivity, sort_order: idx + 1,
      };
      if (t.id) {
        const { error } = await supabase.from("license_tiers").update(row).eq("id", t.id);
        if (error) throw error;
        savedTiers.push({ ...t, sort_order: idx + 1 });
      } else {
        const { data, error } = await supabase.from("license_tiers").insert(row).select("id").single();
        if (error) throw error;
        savedTiers.push({ ...t, id: data!.id, sort_order: idx + 1 });
      }
    }
    setTiers(savedTiers);
    const keepIds = savedTiers.map((t) => t.id).filter(Boolean) as string[];
    const { data: existing } = await supabase.from("license_tiers")
      .select("id").eq("listing_id", listingId);
    for (const row of existing ?? []) {
      if (!keepIds.includes(row.id)) {
        const { error } = await supabase.from("license_tiers").delete().eq("id", row.id);
        if (error) throw new Error("A removed tier already has licenses — it was kept.");
      }
    }

    // Prohibited-use clauses: replace-set (creator clauses only; platform ones are implicit)
    await supabase.from("listing_prohibited_uses").delete().eq("listing_id", listingId);
    const rows = Object.entries(selected).map(([clause_id, custom_note]) => ({
      listing_id: listingId, clause_id, custom_note,
    }));
    if (rows.length) {
      const { error } = await supabase.from("listing_prohibited_uses").insert(rows);
      if (error) throw error;
    }
    return listingId!;
  }

  async function onSave() {
    setBusy("save"); setMsg(null);
    try {
      await persist();
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(null); }
  }

  async function onPublish() {
    setBusy("publish"); setMsg(null);
    try {
      const id = await persist();
      const { error } = await supabaseBrowser().from("listings")
        .update({ status: "published" }).eq("id", id);
      if (error) {
        throw new Error(
          error.message.includes("PUBLISH:")
            ? "Publishing blocked: your replica must be ready and consent verified, with at least 1 tier."
            : error.message,
        );
      }
      setListing((l) => ({ ...l, status: "published" }));
      setMsg({ kind: "ok", text: "Published — you're live in the marketplace." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Listing</CardTitle>
              <CardDescription>What buyers see on your public page.</CardDescription>
            </div>
            <Badge variant="outline" className="capitalize">{listing.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Headline</Label>
            <Input id="title" value={listing.title} maxLength={90}
              onChange={(e) => setListing({ ...listing, title: e.target.value })}
              placeholder="Tech & fitness creator — honest, energetic endorsements" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={listing.bio} rows={3} maxLength={400}
              onChange={(e) => setListing({ ...listing, bio: e.target.value })}
              placeholder="Who you are and what brands you love working with." />
          </div>
          <div className="grid gap-2">
            <Label>Allowed categories</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" onClick={() => toggleCategory(c)}
                  className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
                    listing.allowed_categories.includes(c)
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licensing tiers</CardTitle>
          <CardDescription>Price in ₹ · license length · videos included.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_110px_90px_90px_120px_36px]">
              <div className="grid gap-1">
                <Label className="text-xs">Name</Label>
                <Input value={t.name} onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Price (₹)</Label>
                <Input type="number" min={1} value={t.price_inr}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, price_inr: Number(e.target.value) } : x))} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Days</Label>
                <Input type="number" min={1} value={t.duration_days}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, duration_days: Number(e.target.value) } : x))} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Videos</Label>
                <Input type="number" min={1} value={t.max_generations}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, max_generations: Number(e.target.value) } : x))} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Exclusivity</Label>
                <select
                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  value={t.exclusivity}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, exclusivity: e.target.value as TierDraft["exclusivity"] } : x))}
                >
                  <option value="none">None</option>
                  <option value="category">Category</option>
                  <option value="full">Full</option>
                </select>
              </div>
              <Button variant="ghost" size="icon" className="text-muted-foreground"
                onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remove tier">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit"
            onClick={() => setTiers([...tiers, { name: "New tier", price_inr: 9999, duration_days: 30, max_generations: 2, exclusivity: "none", sort_order: tiers.length + 1 }])}>
            <Plus className="size-4" /> Add tier
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prohibited uses</CardTitle>
          <CardDescription>
            Scripts violating a checked rule are blocked before payment, citing the clause.
            Platform-wide rules (political, health misinformation, fraud, adult, minors) always apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {clauses.map((c) => {
            const on = c.id in selected;
            return (
              <div key={c.id} className={`rounded-lg border p-3 transition-colors ${on ? "border-primary/40 bg-primary/5" : ""}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggleClause(c.id)}
                    className="mt-1 size-4 accent-[var(--primary)]" />
                  <span>
                    <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{c.code}</span>
                    <span className="text-sm font-medium">{c.title}</span>
                    <span className="block text-sm text-muted-foreground">{c.description}</span>
                  </span>
                </label>
                {on && c.code === "PC-07" && (
                  <Input className="mt-2" placeholder="Excluded brands, e.g. 'no fast-fashion brands'"
                    value={selected[c.id] ?? ""}
                    onChange={(e) => setSelected({ ...selected, [c.id]: e.target.value || null })} />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {msg && (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
          {msg.text}
        </p>
      )}
      {!avatarReady && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          You can draft everything now — publishing unlocks once your replica is ready and consent is verified.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onSave} disabled={busy !== null} variant="outline">
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save draft
        </Button>
        <Button onClick={onPublish} disabled={busy !== null || !avatarReady}>
          {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Globe2 className="size-4" />}
          {listing.status === "published" ? "Republish changes" : "Publish to marketplace"}
        </Button>
        {listing.status === "published" && listing.id && (
          <Button render={<Link href={`/marketplace/${listing.id}`} />} nativeButton={false} variant="ghost">
            <ExternalLink className="size-4" /> View public page
          </Button>
        )}
      </div>
    </div>
  );
}
