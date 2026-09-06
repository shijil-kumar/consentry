"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Flag, Loader2, Check } from "lucide-react";

const CATEGORIES = [
  { value: "impersonation", label: "Impersonation / not the real person (2h SLA)" },
  { value: "non_consensual", label: "Non-consensual likeness (2h SLA)" },
  { value: "ip_infringement", label: "IP / trademark infringement" },
  { value: "unlawful_content", label: "Unlawful or misleading content" },
  { value: "other", label: "Something else" },
] as const;

export function ReportButton({ generationId }: { generationId: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("impersonation");
  const [detail, setDetail] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (detail.trim().length < 10) { setError("Please add a short description."); return; }
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc("file_report", {
      p_generation_id: generationId,
      p_category: category,
      p_detail: detail.trim(),
      p_reporter_email: email || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <p className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        <Check className="size-4" /> Report received — our team reviews within the SLA.
      </p>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
        <Flag className="size-4" /> Report this video
      </button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <Flag className="size-4 text-amber-400" /> Report this video
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        Reports are triaged against India&apos;s IT Rules 2026 takedown timelines.
      </p>
      <div className="mt-3 grid gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-200">
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={600}
          placeholder="What's wrong with this video?"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
          placeholder="Your email (optional, for follow-up)"
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-200" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />} Submit report
          </button>
          <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button>
        </div>
      </div>
    </div>
  );
}
