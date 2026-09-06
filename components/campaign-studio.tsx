"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, ArrowRight, Megaphone } from "lucide-react";

export interface CampaignListing {
  id: string;
  display_name: string;
  allowed_categories: string[];
}

// Campaign Studio: one product brief → rule-compliant drafts for several
// creators at once (each draft is shaped by THAT creator's own rules via the
// existing script-assist endpoint). One brief becomes N licensed videos.
export function CampaignStudio({ listings }: { listings: CampaignListing[] }) {
  const [brief, setBrief] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Array<{ id: string; name: string; script?: string; error?: string }>>([]);

  const toggle = (id: string) =>
    setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]);

  async function draftAll() {
    if (brief.trim().length < 5) { setError("Describe what you're promoting first."); return; }
    if (selected.length === 0) { setError("Pick at least one creator."); return; }
    setBusy(true); setError(null); setDrafts([]);
    const chosen = listings.filter((l) => selected.includes(l.id));
    const results = await Promise.all(chosen.map(async (l) => {
      try {
        const res = await fetch("/api/script-assist", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ listing_id: l.id, brief }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "draft failed");
        return { id: l.id, name: l.display_name, script: j.script as string };
      } catch (e) {
        return { id: l.id, name: l.display_name, error: (e as Error).message };
      }
    }));
    setDrafts(results);
    setBusy(false);
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <label className="text-sm font-medium">What are you promoting?</label>
        <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={600}
          placeholder="e.g. AeroFit smart band — sleep tracking, launch offer 20% off, audience: young professionals" />
      </div>

      <div className="grid gap-1.5">
        <label className="text-sm font-medium">Pick creators (up to 3)</label>
        <div className="flex flex-wrap gap-2">
          {listings.map((l) => (
            <button key={l.id} type="button" onClick={() => toggle(l.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selected.includes(l.id) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              {l.display_name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Each draft is written against that creator&apos;s OWN rules, so they arrive gate-ready.
        </p>
      </div>

      <Button onClick={draftAll} disabled={busy} size="lg" className="w-fit">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "Drafting for each creator…" : `Draft scripts for ${selected.length || "…"} creator${selected.length === 1 ? "" : "s"}`}
      </Button>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {drafts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {drafts.map((d) => (
            <div key={d.id} className="flex flex-col rounded-2xl border bg-card p-4 shadow-sm">
              <p className="flex items-center gap-2 font-semibold"><Megaphone className="size-4 text-primary" /> {d.name}</p>
              {d.script ? (
                <>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{d.script}</p>
                  <Button render={<Link href={`/marketplace/${d.id}/request?draft=${encodeURIComponent(d.script)}`} />}
                    nativeButton={false} size="sm" className="mt-3 w-full">
                    Review &amp; submit <ArrowRight className="size-4" />
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-destructive">{d.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
