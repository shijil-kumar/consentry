"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AD_TEMPLATES } from "@/lib/ad-templates";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, ShieldCheck, ShieldX, Hourglass, ArrowRight, PencilLine, Sparkles,
} from "lucide-react";

interface Cited { code: string; title: string; description: string; evidence_excerpt?: string }
type Outcome = "auto_approved" | "rejected" | "needs_review";

export function ScriptRequestForm({
  listingId, tierId, tierName, allowedCategories, initialScript,
}: {
  listingId: string;
  tierId: string;
  tierName: string;
  allowedCategories: string[];
  initialScript?: string;
}) {
  const [category, setCategory] = useState(allowedCategories[0] ?? "");
  const [language, setLanguage] = useState("en");
  const [videoStyle, setVideoStyle] = useState<"talking_head" | "scene">("talking_head");
  const [tone, setTone] = useState("natural");
  const [script, setScript] = useState(initialScript ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; requestId: string; cited: Cited[]; latency: number } | null>(null);
  const [brief, setBrief] = useState("");
  const [assisting, setAssisting] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);

  async function assist(wantVariants = false) {
    if (brief.trim().length < 5) { setError("Add a short brief (what to promote)."); return; }
    setAssisting(true); setError(null);
    try {
      const res = await fetch("/api/script-assist", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing_id: listingId, brief, variants: wantVariants }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error === "assistant_unavailable" ? "The AI assistant needs the Anthropic key — add credits to enable it." : (j.error ?? "assist failed"));
      setScript(j.script);
      setVariants(j.variants ?? []);
      if (!wantVariants) setAssistOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally { setAssisting(false); }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing_id: listingId, tier_id: tierId, category, script, language, video_style: videoStyle, tone }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
      setResult({ outcome: j.outcome, requestId: j.request_id, cited: j.cited_clauses ?? [], latency: j.latency_ms });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (result?.outcome === "auto_approved") {
    return (
      <Card className="border-emerald-500/40">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500/15">
              <ShieldCheck className="size-5 text-emerald-600" />
            </span>
            <div>
              <p className="font-medium">Script approved</p>
              <p className="text-sm text-muted-foreground">
                Checked against every active rule in {(result.latency / 1000).toFixed(1)}s. Your {tierName} license is ready for checkout.
              </p>
            </div>
          </div>
          <Button render={<Link href={`/buyer/requests/${result.requestId}`} />} nativeButton={false} className="w-full">
            Proceed to checkout <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (result?.outcome === "needs_review") {
    return (
      <Card className="border-amber-500/40">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-amber-500/15">
              <Hourglass className="size-5 text-amber-600" />
            </span>
            <div>
              <p className="font-medium">Sent to the creator for review</p>
              <p className="text-sm text-muted-foreground">
                The automated check couldn&apos;t clear this one confidently — the creator
                decides. You&apos;ll see the decision in your workspace. Nothing has been charged.
              </p>
            </div>
          </div>
          <Button render={<Link href="/buyer" />} nativeButton={false} variant="outline" className="w-full">
            Back to workspace
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {result?.outcome === "rejected" && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-red-500/15">
                <ShieldX className="size-5 text-red-600" />
              </span>
              <div>
                <p className="font-medium">Blocked by the creator&apos;s rules</p>
                <p className="text-sm text-muted-foreground">
                  Nothing was generated and nothing was charged. Edit the script and resubmit.
                </p>
              </div>
            </div>
            <ul className="space-y-2">
              {result.cited.map((c) => (
                <li key={c.code} className="rounded-lg border border-red-500/30 bg-background p-3 text-sm">
                  <span className="mr-2 rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-xs text-red-600">{c.code}</span>
                  <span className="font-medium">{c.title}</span>
                  <span className="block mt-1 text-muted-foreground">&ldquo;{c.description}&rdquo;</span>
                  {c.evidence_excerpt && (
                    <span className="mt-1 block text-xs text-red-600/80">
                      Evidence: “…{c.evidence_excerpt}…”
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-1.5">
        <Label>Campaign category</Label>
        <div className="flex flex-wrap gap-2">
          {allowedCategories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
                category === c ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Output language</Label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
            <option value="ml">Malayalam</option>
            <option value="bn">Bengali</option>
            <option value="kn">Kannada</option>
            <option value="mr">Marathi</option>
          </select>
          <p className="text-xs text-muted-foreground">One consent, any language — the replica speaks it.</p>
          <Label className="mt-1">Delivery tone</Label>
          <select value={tone} onChange={(e) => setTone(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="natural">Natural</option>
            <option value="excited">Excited</option>
            <option value="calm">Calm</option>
            <option value="warm">Warm</option>
            <option value="confident">Confident</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label>Video style</Label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setVideoStyle("talking_head")}
              className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${videoStyle === "talking_head" ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <span className="block font-semibold">Talking head</span>
              <span className="text-muted-foreground">Best lip accuracy, fastest</span>
            </button>
            <button type="button" onClick={() => setVideoStyle("scene")}
              className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${videoStyle === "scene" ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <span className="block font-semibold">Scene / product-in-hand</span>
              <span className="text-muted-foreground">Cinematic engines (rolling out)</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="script">Endorsement script (spoken by the creator&apos;s replica)</Label>
          <button type="button" onClick={() => setAssistOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
            <Sparkles className="size-3.5" /> Help me write it
          </button>
        </div>
        {assistOpen && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <Label className="text-xs">What are you promoting? (a one-line brief)</Label>
            <div className="mt-1.5 flex gap-2">
              <input value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={300}
                placeholder="e.g. our new AeroFit sleep-tracking smart band, launch offer"
                className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm" />
              <Button type="button" size="sm" onClick={() => assist()} disabled={assisting}>
                {assisting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => assist(true)} disabled={assisting}>
                3 variants
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The draft is pre-shaped by this creator&apos;s rules, so it&apos;s far more likely to pass.
            </p>
            {variants.length > 1 && (
              <div className="mt-3 grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">A/B variants — tap to use one:</p>
                {variants.map((v, i) => (
                  <button key={i} type="button" onClick={() => { setScript(v); setAssistOpen(false); }}
                    className={`rounded-lg border p-2.5 text-left text-xs leading-relaxed transition-colors hover:border-primary/40 ${script === v ? "border-primary bg-primary/5" : ""}`}>
                    <span className="mb-1 block font-semibold text-primary">Variant {String.fromCharCode(65 + i)}</span>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Start from a template:</span>
          {AD_TEMPLATES.map((t) => (
            <button key={t.slug} type="button" onClick={() => setScript(t.body)}
              className="rounded-full border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
              {t.name}
            </button>
          ))}
        </div>
        <Textarea id="script" rows={6} value={script} maxLength={2000}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Write exactly what the replica should say — checked live against the creator's rules before any payment. Or pick a template above and fill the [brackets]." />
        <p className="text-right text-xs text-muted-foreground">{script.length}/2000 · min 20</p>
        {process.env.NEXT_PUBLIC_DEMO_EXAMPLES === "1" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-2.5">
            <span className="text-xs font-medium text-amber-600">Demo examples:</span>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => setScript("I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely the best I have used. If better sleep is on your list, check them out at aerofit.in.")}>
              Paste a passing script
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => setScript("Doctors do not want you to know this: BurnMax capsules melted 8 kg off me in 3 weeks and normalized my blood sugar. No diet, no exercise. Use my code for 40% off.")}>
              Paste a blocked script
            </Button>
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={busy || script.trim().length < 20} size="lg">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <PencilLine className="size-4" />}
        {busy ? "Checking against the rules…" : result?.outcome === "rejected" ? "Resubmit edited script" : "Run the rules check"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Approval always happens BEFORE payment. A blocked script costs nothing.
      </p>
    </div>
  );
}
