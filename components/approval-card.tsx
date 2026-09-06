"use client";

import { useEffect, useState } from "react";
import { ProcessSteps } from "@/components/process-steps";
import {
  ShieldCheck, ThumbsUp, MessageSquareText, XCircle, Loader2, Clock, IndianRupee, BadgeCheck,
} from "lucide-react";

interface Info {
  status: string; brand: string; fee_paise: number | null; script: string;
  version: number; review_deadline: string | null; preview_url: string | null;
  ai_check: { outcome?: string; cited?: number } | null;
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function ApprovalCard({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "changes" | "decline">("view");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // async boundary: current time is only knowable client-side (hydration)
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    fetch(`/api/approval/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error === "expired" ? "This review link has expired. A reminder with a fresh link is on its way." : j.error === "already_used" ? "This link was already used — the decision is recorded in the ledger." : "This review link is not valid.");
        setInfo(j);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function act(action: "approve" | "changes" | "decline") {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/approval/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, comment: comment || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "action failed");
      setResult(j.status);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (error && !info) {
    return <p className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-300">{error}</p>;
  }
  if (!info) {
    return (
      <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <ProcessSteps active={0} steps={[
          { label: "Opening your secure review link", detail: "Checking the single-use token…" },
          { label: "Loading the watermarked preview", detail: "The final master stays locked until you approve." },
        ]} />
      </div>
    );
  }

  if (result || info.status !== "celebrity_review") {
    const s = result ?? info.status;
    const msg = s === "approved"
      ? { icon: ThumbsUp, title: "Approved — releasing the final video", body: "Your approval is on the ledger with the script fingerprint. The sealed, labelled master is being released to the brand now." }
      : s === "changes_requested"
      ? { icon: MessageSquareText, title: "Changes requested", body: "The brand can see your note and submit a revised version — it will come back to you as v" + (info.version + 1) + "." }
      : s === "rejected"
      ? { icon: XCircle, title: "Declined", body: "Nothing will be released. Your decision and reason are recorded on the ledger." }
      : { icon: Clock, title: "Already decided", body: "This request has moved on — the decision is on the ledger." };
    return (
      <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-zinc-900/60 p-6 text-center">
        <msg.icon className="mx-auto size-9 text-emerald-400" />
        <p className="mt-3 text-lg font-semibold">{msg.title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{msg.body}</p>
        {/* Every terminal state used to be a hard dead end: this is the hero
            screen of the whole pitch, opened from a phone with no app chrome,
            and after deciding there was nowhere to go. */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a href="/creator"
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400">
            Open my studio
          </a>
          <a href="/creator/protection"
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900">
            See what&apos;s protecting me
          </a>
        </div>
      </div>
    );
  }

  const hoursLeft = info.review_deadline && now
    ? Math.max(0, Math.round((new Date(info.review_deadline).getTime() - (now ?? 0)) / 3600000))
    : null;

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-zinc-400">Request from</p>
          {hoursLeft !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
              <Clock className="size-3" /> {hoursLeft}h left — we never auto-approve
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xl font-semibold">{info.brand}</p>
        {info.fee_paise !== null && (
          <p className="mt-1 flex items-center gap-1 text-sm text-emerald-400">
            <IndianRupee className="size-3.5" /> {inr(info.fee_paise).slice(1)} license · v{info.version}
          </p>
        )}
      </div>

      {info.preview_url ? (
        <video src={info.preview_url} controls playsInline className="w-full rounded-2xl border border-zinc-800" />
      ) : (
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">Preview is still rendering — refresh in a moment.</p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Watermarked preview. The clean master stays locked until you approve.
      </p>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <ShieldCheck className="size-3.5" /> AI safety check
          {info.ai_check?.outcome === "auto_approved" && <span className="ml-1 inline-flex items-center gap-1 text-emerald-300"><BadgeCheck className="size-3" /> No rule conflicts detected</span>}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{info.script}</p>
      </div>

      {mode !== "view" && (
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000}
          placeholder={mode === "changes" ? "What should the brand change?" : "Why are you declining? (required)"}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 placeholder:text-zinc-500" />
      )}
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      {mode === "view" ? (
        <div className="grid gap-2">
          <button onClick={() => act("approve")} disabled={busy}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-60">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ThumbsUp className="size-5" />} Approve & release
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode("changes")} disabled={busy}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-200 hover:bg-zinc-900">
              <MessageSquareText className="size-4" /> Request changes
            </button>
            <button onClick={() => setMode("decline")} disabled={busy}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-red-500/40 text-sm font-medium text-red-400 hover:bg-red-500/10">
              <XCircle className="size-4" /> Decline
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMode("view")} disabled={busy}
            className="h-11 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-900">
            Back
          </button>
          <button onClick={() => act(mode === "changes" ? "changes" : "decline")} disabled={busy || comment.trim().length === 0}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-950 hover:bg-white disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "changes" ? "Send to brand" : "Confirm decline"}
          </button>
        </div>
      )}
    </div>
  );
}
