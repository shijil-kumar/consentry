"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProcessSteps, ElapsedBadge } from "@/components/process-steps";
import {
  Loader2, CreditCard, Sparkles, ShieldCheck, ShieldX, BadgeCheck, FileVideo2, ExternalLink, Wallet,
} from "lucide-react";

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// One entry per engine the creator's likeness is trained on, plus the platform
// default first. Wording carries the honesty: a live engine says how long it
// takes; the default says it is the instant demo path.
//
// There is deliberately no "Seedance — coming soon" chip. Probing HeyGen's API
// on 2026-08-04 across 14 endpoints found NO cinematic-model surface at all
// (/v2/video/models, /v2/video/avatar_shots and every sibling 404) — their
// Seedance integration is web-Studio-only. Promising an engine we have no way
// to reach would be the one thing this product cannot afford to do.
const ENGINE_INFO: Record<string, { title: string; shape: string; eta: string }> = {
  tavus: { title: "Studio · Tavus", shape: "Widescreen 16:9", eta: "fresh render, ~3–4 min" },
  heygen: { title: "Social · HeyGen", shape: "Vertical 9:16 for Reels/Shorts", eta: "fresh render, ~2 min" },
};

function EnginePicker({ engines, replayEngines, value, onChange }: {
  engines: string[];
  /** Engines with no usable subscription — a fresh render there is impossible. */
  replayEngines?: string[];
  /** `${engine}:${mode}`, e.g. "heygen:instant". */
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const replaying = new Set(replayEngines ?? []);
  const ORDER = ["tavus", "heygen"];
  const usable = engines.filter((e) => ENGINE_INFO[e])
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  // Two axes, because these are two different questions: WHICH engine's look do
  // you want, and do you want it now or rendered fresh.
  //
  // The old picker had a single generic "Instant demo" served by the mock
  // engine, so an instant preview was always the same 16:9 clip regardless of
  // the engine under discussion — there was no way to show what HeyGen produces
  // without paying for a render and narrating over minutes of spinner.
  const rows: Array<{ mode: "instant" | "live"; title: string; sub: string }> = [
    { mode: "instant", title: "Instant preview",
      sub: "That engine's own most recent render, replayed. Free and immediate — the way to show how each engine looks." },
    { mode: "live", title: "Render fresh",
      sub: "Calls the paid engine and renders this exact script. A couple of minutes." },
  ];

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-medium">Render engine</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Same consent and the same approval step either way — the celebrity still reviews
          before anything is released.
        </p>
      </div>

      {rows.map((row) => (
        <div key={row.mode}>
          <p className="mb-0.5 text-sm font-medium">{row.title}</p>
          <p className="mb-2 text-xs text-muted-foreground">{row.sub}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {usable.map((e) => {
              const key = `${e}:${row.mode}`;
              const active = value === key;
              // A fresh render is genuinely impossible without a subscription;
              // the instant preview of that same engine still works, which is
              // exactly why its earlier output is kept.
              const blocked = row.mode === "live" && replaying.has(e);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => !blocked && onChange(key)}
                  disabled={blocked}
                  aria-pressed={active}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    blocked
                      ? "cursor-not-allowed opacity-55"
                      : active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-muted-foreground/40"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {ENGINE_INFO[e].title}
                    {blocked && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        No subscription
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {ENGINE_INFO[e].shape}
                    {row.mode === "instant"
                      ? " · replay, free"
                      : blocked ? " · unavailable right now" : ` · ${ENGINE_INFO[e].eta}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {replaying.size > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          An engine marked <b>No subscription</b> cannot render fresh right now — but its instant
          preview still works, and everything around it stays real: rules check, licence,
          approval, visible AI label, Content Credentials.
        </p>
      )}
    </div>
  );
}

type ReqStatus = "pending_check" | "auto_approved" | "needs_review" | "approved" | "rejected" | "expired";
type LicStatus = "payment_pending" | "active" | "expired" | "revoked";
type GenStatus = "queued" | "generating" | "processing" | "celebrity_review" | "changes_requested" | "approved" | "rejected" | "delivered" | "failed" | "blocked";

export interface WorkspaceData {
  requestId: string;
  requestStatus: ReqStatus;
  script: string;
  cited: Array<{ code: string; title: string; description: string; evidence_excerpt?: string }>;
  tierName: string;
  amountPaise: number;
  creatorName: string;
  license: {
    id: string; status: LicStatus; expires_at: string | null;
    // Terms SNAPSHOTTED at purchase (migration 0024) — shown so the lock is a
    // visible promise, not invisible schema hygiene.
    tier_name?: string | null; max_generations?: number | null; duration_days?: number | null;
  } | null;
  // watermarked / c2pa_manifest._signed record what the pipeline ACTUALLY did to
  // this file. The delivery card used to assert "AI-labelled + C2PA signed"
  // unconditionally, which was false wherever a step had degraded — and the
  // brand is looking at the file while reading it.
  generations: Array<{
    id: string; status: GenStatus; error: string | null;
    created_at?: string | null;
    watermarked?: boolean | null;
    c2pa_manifest?: { _signed?: boolean } | null;
  }>;
  // Engines this creator's likeness is actually trained on (ready avatar +
  // verified consent). Empty for seeded demo creators → no picker, the staged
  // instant engine renders as always.
  engines: string[];
  /** Subset of `engines` with no active subscription — they will replay. */
  replayEngines?: string[];
}

const GEN_LABEL: Record<GenStatus, string> = {
  queued: "Queued", generating: "Rendering the master", processing: "Working on your video",
  celebrity_review: "Awaiting celebrity approval", changes_requested: "Changes requested",
  approved: "Approved - sealing & delivering", rejected: "Declined by the celebrity",
  delivered: "Delivered", failed: "Failed", blocked: "Blocked (consent revoked)",
};

export function RequestWorkspace({ initial }: { initial: WorkspaceData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeGen = data.generations[0];
  const inFlight = activeGen && ["queued", "generating", "processing", "celebrity_review", "approved"].includes(activeGen.status);
  const delivered = data.generations.find((g) => g.status === "delivered");

  const [changeNote, setChangeNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data: req }, { data: lic }, { data: gens }] = await Promise.all([
      supabase.from("approval_requests").select("status").eq("id", data.requestId).maybeSingle(),
      data.license
        ? supabase.from("licenses").select("id, status, expires_at").eq("id", data.license.id).maybeSingle()
        : supabase.from("licenses").select("id, status, expires_at").eq("request_id", data.requestId).maybeSingle(),
      supabase.from("generations").select("id, status, error, created_at").eq("request_id", data.requestId).order("created_at", { ascending: false }),
    ]);
    // The celebrity's change-request note was written to the ledger but never
    // shown to the brand — they saw "changes requested" with no idea what to change.
    let note: string | null = null;
    const latest = (gens ?? [])[0];
    if (latest && latest.status === "changes_requested") {
      const { data: ev } = await supabase
        .from("approval_events")
        .select("comment, action, created_at")
        .eq("generation_id", latest.id)
        .eq("action", "changes_requested")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      note = ev?.comment ?? null;
    }
    setChangeNote(note);
    setData((d) => ({
      ...d,
      requestStatus: (req?.status as ReqStatus) ?? d.requestStatus,
      // keep the purchase-time snapshot fields — the poll deliberately fetches
      // only the mutable state columns
      license: lic ? { ...d.license, id: lic.id, status: lic.status, expires_at: lic.expires_at } : d.license,
      generations: gens ?? d.generations,
    }));
    // Kick the worker (org-scoped, authenticated) so mid-flight generations
    // advance even where the minute-cron doesn't run (Vercel Hobby = daily crons).
    if ((gens ?? []).some((g) => ["queued", "generating", "processing", "approved"].includes(g.status))) {
      fetch("/api/jobs/generation-worker", { method: "POST" }).catch(() => {});
    }
  }, [data.requestId, data.license]);

  // poll while anything is mid-flight
  useEffect(() => {
    const shouldPoll =
      data.license?.status === "payment_pending" || inFlight ||
      data.requestStatus === "pending_check";
    if (!shouldPoll) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(refresh, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [data.license?.status, data.requestStatus, inFlight, refresh]);

  // fetch a signed URL once delivered; during review states fetch the preview
  useEffect(() => {
    if (delivered && !assetUrl) {
      fetch(`/api/assets/${delivered.id}`).then(async (r) => {
        if (r.ok) setAssetUrl((await r.json()).url);
      }).catch(() => {});
    }
  }, [delivered, assetUrl]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const reviewGen = data.generations.find((g) =>
    ["celebrity_review", "changes_requested", "approved", "rejected"].includes(g.status));
  useEffect(() => {
    if (reviewGen && !previewUrl) {
      fetch(`/api/assets/${reviewGen.id}`).then(async (r) => {
        if (r.ok) {
          const j = await r.json();
          if (j.kind === "preview") setPreviewUrl(j.url);
        }
      }).catch(() => {});
    }
  }, [reviewGen, previewUrl]);

  const [wallet, setWallet] = useState<number | null>(null);
  useEffect(() => {
    supabaseBrowser().from("credit_wallets").select("balance_paise").maybeSingle()
      .then(({ data: w }) => setWallet(w?.balance_paise ?? 0));
  }, []);

  async function payWithCredits() {
    setBusy("pay"); setError(null);
    try {
      // begin_checkout creates (or returns) the payment_pending license…
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: data.requestId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "checkout failed");
      // …then the wallet debits and activates through the canonical path.
      const { data: bal, error: rpcErr } = await supabaseBrowser()
        .rpc("pay_license_with_credits", { p_license_id: j.license_id });
      if (rpcErr) throw new Error(rpcErr.message.replace(/^CREDITS:/, "").replace(/_/g, " "));
      setWallet(typeof bal === "number" ? bal : wallet);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  async function pay() {
    setBusy("pay"); setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: data.requestId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "checkout failed");

      if (j.provider === "mock") {
        // dev/demo: simulate the webhook
        const conf = await fetch("/api/payments/mock-confirm", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ license_id: j.license_id }),
        });
        if (!conf.ok) throw new Error((await conf.json()).error ?? "mock confirm failed");
      } else {
        await openRazorpay(j);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  async function openRazorpay(order: { order_id: string; amount_paise: number; key_id: string }) {
    await new Promise<void>((resolve, reject) => {
      if (document.getElementById("rzp-sdk")) return resolve();
      const s = document.createElement("script");
      s.id = "rzp-sdk"; s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(); s.onerror = () => reject(new Error("razorpay sdk failed"));
      document.body.appendChild(s);
    });
    await new Promise<void>((resolve) => {
      // @ts-expect-error injected global
      const rzp = new window.Razorpay({
        key: order.key_id, order_id: order.order_id, amount: order.amount_paise,
        name: "Consent First", description: data.tierName,
        handler: () => resolve(), // webhook activates; we just close + poll
        modal: { ondismiss: () => resolve() },
      });
      rzp.open();
    });
  }

  // "<engine>:<mode>" — e.g. "tavus:instant". null = platform default (the free
  // demo engine under safe mode). Holding both halves in one value keeps the
  // picker a single-selection control: you cannot end up having chosen a mode
  // without an engine, which is a state the API would reject anyway.
  const [engine, setEngine] = useState<string | null>(() => {
    const ORDER = ["tavus", "heygen"];
    const first = (initial.engines ?? [])
      .filter((e) => e === "tavus" || e === "heygen")
      .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
    return first ? `${first}:instant` : null;
  });

  async function generate() {
    if (!data.license) return;
    setBusy("generate"); setError(null);
    try {
      const res = await fetch("/api/generations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          license_id: data.license.id,
          ...(engine
            ? { engine: engine.split(":")[0], mode: engine.split(":")[1] as "instant" | "live" }
            : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? "generation failed");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  const approved = data.requestStatus === "auto_approved" || data.requestStatus === "approved";
  const licenseActive = data.license?.status === "active";

  const gen = activeGen;
  const STAGES = [
    { label: "Script approved by the AI gate", detail: "Checked against the platform rules and the celebrity's own no-go list.", eta: "Typically under 10 seconds." },
    { label: "Payment secured", detail: "License active - the render cost is committed.", eta: "Instant." },
    { label: "Rendering the master", detail: "Generated ONCE at final quality, stored in a private vault.",
      eta: engine?.endsWith(":instant")
        ? "An instant preview — seconds. The visible AI label and Content Credentials are still applied for real, so it is not quite instantaneous."
        : "Typically 2 to 4 minutes for a fresh render, depending on the engine and script length. The page refreshes itself every 3 seconds — you can leave and come back." },
    { label: "Watermarked preview created", detail: "A 480p preview goes to the celebrity. The clean master stays locked.", eta: "Typically 10-30 seconds." },
    { label: "Celebrity reviewing", detail: "Approve, request changes, or decline - never auto-approved.",
      eta: "Waiting on a human — this one has no timer, and that is the point." },
    { label: "Sealing & delivering", detail: "Visible label + C2PA provenance sealed into the file.", eta: "Typically 10-40 seconds." },
  ];
  const stageIndex =
    !gen ? 0
    : gen.status === "queued" ? 2
    : gen.status === "generating" ? 2
    : gen.status === "processing" ? 3
    : gen.status === "celebrity_review" ? 4
    : gen.status === "changes_requested" ? 4
    : gen.status === "approved" ? 5
    : gen.status === "delivered" ? 6 : 2;

  return (
    <div className="grid gap-6">
      {/* Script */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Your script</CardTitle>
            <StatusBadge requestStatus={data.requestStatus} licenseActive={licenseActive} />
          </div>
          <CardDescription>{data.creatorName} · {data.tierName} · {inr(data.amountPaise)}</CardDescription>
        </CardHeader>
        <CardContent>
          <blockquote className="rounded-lg border-l-2 border-primary/40 bg-muted/50 px-4 py-3 text-sm italic">
            &ldquo;{data.script}&rdquo;
          </blockquote>
        </CardContent>
      </Card>

      {/* Errors live at the TOP LEVEL: this block used to sit inside the
          licence-active card, so a failed "Pay" or "Top up" set the error and
          then rendered nothing at all — the most important button in the
          product failed in complete silence. */}
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Rejected */}
      {data.requestStatus === "rejected" && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 font-medium"><ShieldX className="size-5 text-red-600" /> Blocked by the rules — nothing charged</p>
            {data.cited.map((c) => (
              <p key={c.code} className="text-sm">
                <span className="mr-2 rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-xs text-red-600">{c.code}</span>
                {c.title} — <span className="text-muted-foreground">{c.description}</span>
              </p>
            ))}
            <Button render={<Link href="/marketplace" />} nativeButton={false} variant="outline">Browse creators</Button>
          </CardContent>
        </Card>
      )}

      {data.requestStatus === "needs_review" && (
        <Card className="border-amber-500/40">
          <CardContent className="py-6 text-sm text-muted-foreground">
            The creator is reviewing this script. You&apos;ll be able to pay once they approve. Nothing has been charged.
          </CardContent>
        </Card>
      )}

      {/* Pay */}
      {approved && !licenseActive && (
        <Card className="border-emerald-500/40">
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-5 text-emerald-600" /> Approved — ready for checkout</p>
            {wallet !== null && wallet >= data.amountPaise && (
              <Button onClick={payWithCredits} disabled={busy !== null} size="lg" className="w-full">
                {busy === "pay" ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                Pay {inr(data.amountPaise)} from credits ({inr(wallet)} available)
              </Button>
            )}
            <Button onClick={pay} disabled={busy !== null} size="lg" variant={wallet !== null && wallet >= data.amountPaise ? "outline" : "default"} className="w-full">
              {busy === "pay" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              Pay {inr(data.amountPaise)} {data.license?.status === "payment_pending" ? "(retry)" : ""}
            </Button>
            <p className="text-xs text-muted-foreground">Payments run in test mode during the pilot. Top up credits from the brand workspace.</p>
          </CardContent>
        </Card>
      )}

      {/* Generate */}
      {licenseActive && !delivered && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2">
              <BadgeCheck className="size-5 text-emerald-600" />
              <p className="font-medium">License active</p>
              {data.license?.expires_at && (
                <span className="text-sm text-muted-foreground">
                  · expires {new Date(data.license.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              )}
            </div>
            {data.license?.max_generations != null && (
              <p className="text-xs text-muted-foreground">
                Terms locked at purchase: {data.license.tier_name ?? "licence"} ·{" "}
                {data.license.max_generations} video{data.license.max_generations > 1 ? "s" : ""} ·{" "}
                {data.license.duration_days} days · {inr(data.amountPaise)}. These cannot change under an
                active licence — not by us, not by anyone.
              </p>
            )}
            {inFlight ? (
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {GEN_LABEL[activeGen!.status]}
                  <ElapsedBadge
                    // Only while the MACHINE owes you something. Ticking a clock
                    // through "Celebrity reviewing" would read as a deadline on a
                    // human decision — the one step that deliberately has none.
                    startedAt={
                      ["queued", "generating", "processing", "approved"].includes(activeGen!.status)
                        ? activeGen!.created_at ?? null
                        : null
                    }
                  />
                </p>
                <ProcessSteps steps={STAGES} active={stageIndex} />
                {previewUrl && activeGen?.status === "celebrity_review" && (
                  <div className="mt-4">
                    <video src={previewUrl} controls playsInline className="w-full rounded-lg border" />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      This is the watermarked preview the celebrity sees. The clean master unlocks only on their approval.
                    </p>
                  </div>
                )}
              </div>
            ) : activeGen?.status === "changes_requested" ? (
              <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800">The celebrity requested changes</p>
                {changeNote && (
                  <blockquote className="rounded-lg border-l-2 border-amber-400 bg-amber-100/60 px-3 py-2 text-sm text-amber-900">
                    &ldquo;{changeNote}&rdquo;
                  </blockquote>
                )}
                <p className="text-xs text-amber-700">Submit a new version — it goes back through the AI check and their review. Revisions they asked for don&apos;t use up your licence.</p>
                <Button onClick={generate} disabled={busy !== null} variant="outline" size="sm">Submit a new version</Button>
              </div>
            ) : activeGen?.status === "rejected" ? (
              <p className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                The celebrity declined this video. Nothing was released; the decision is on the ledger.
              </p>
            ) : activeGen?.status === "failed" || activeGen?.status === "blocked" ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">
                  {activeGen.status === "blocked" ? "Consent was revoked — this video cannot be generated." : `Generation failed: ${activeGen.error ?? "unknown"}`}
                </p>
                {activeGen.status === "failed" && (
                  <Button onClick={generate} disabled={busy !== null} variant="outline">Retry</Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {data.engines.length > 0 && (
                  <EnginePicker engines={data.engines} replayEngines={data.replayEngines}
                    value={engine} onChange={setEngine} />
                )}
                <Button onClick={generate} disabled={busy !== null} size="lg" className="w-full">
                  {busy === "generate" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Generate the video
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delivered */}
      {delivered && (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileVideo2 className="size-4 text-emerald-600" /> Delivered
            </CardTitle>
            <CardDescription>
              {delivered.watermarked
                ? "Carries the visible AI label, and is on the record in the consent ledger."
                : "On the record in the consent ledger."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assetUrl ? (
              <video src={assetUrl} controls playsInline className="w-full rounded-lg border" />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading your video…
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {delivered.watermarked && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                  <BadgeCheck className="size-3.5" /> AI label burned in
                </Badge>
              )}
              {delivered.c2pa_manifest?._signed && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                  <BadgeCheck className="size-3.5" /> C2PA signed
                </Badge>
              )}
              <Button render={<Link href={`/verify/${delivered.id}`} target="_blank" />} nativeButton={false} variant="outline" size="sm">
                <ExternalLink className="size-4" /> Verify credential
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ requestStatus, licenseActive }: { requestStatus: ReqStatus; licenseActive: boolean }) {
  if (licenseActive) return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">Licensed</Badge>;
  const map: Record<ReqStatus, { label: string; cls: string }> = {
    pending_check: { label: "Checking…", cls: "" },
    auto_approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    needs_review: { label: "In review", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
    rejected: { label: "Blocked", cls: "bg-red-500/15 text-red-700 border-red-500/30" },
    expired: { label: "Expired", cls: "" },
  };
  const s = map[requestStatus];
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}
