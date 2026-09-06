"use client";

import { useState } from "react";
import { ThumbsUp, Loader2, Plus, Sparkles } from "lucide-react";

interface Star { name: string; votes: number }

export function StarVoteList({ initial }: { initial: Star[] }) {
  const [stars, setStars] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function vote(starName: string) {
    if (voted.has(starName)) return;
    setBusy(starName); setError(null);
    try {
      const r = await fetch("/api/star-vote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: starName }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "vote failed");
      setStars((cur) => {
        const others = cur.filter((s) => s.name.toLowerCase() !== starName.toLowerCase());
        return [...others, { name: starName, votes: j.votes }].sort((a, b) => b.votes - a.votes);
      });
      setVoted((v) => new Set(v).add(starName));
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  const max = Math.max(...stars.map((s) => s.votes), 1);

  return (
    <div className="space-y-5">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) vote(name.trim()); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
          placeholder="Add a name — e.g. your favourite actor or athlete"
          className="h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 placeholder:text-zinc-500" />
        <button type="submit" disabled={busy !== null || name.trim().length < 2}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {busy === name.trim() ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Request
        </button>
      </form>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      <ol className="space-y-2">
        {stars.map((s, i) => (
          <li key={s.name} className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
            <div aria-hidden className="absolute inset-y-0 left-0 bg-emerald-500/10 transition-all duration-700"
              style={{ width: `${Math.max((s.votes / max) * 100, 4)}%` }} />
            <div className="relative flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 text-sm font-semibold tabular-nums text-zinc-500">{i + 1}</span>
                <p className="font-medium">{s.name}</p>
                {i === 0 && <Sparkles className="size-4 text-amber-400" aria-label="Most requested" />}
              </div>
              <button onClick={() => vote(s.name)} disabled={busy !== null || voted.has(s.name)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  voted.has(s.name)
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "border border-zinc-700 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-400"}`}>
                {busy === s.name ? <Loader2 className="size-4 animate-spin" /> : <ThumbsUp className="size-4" />}
                <span className="tabular-nums">{s.votes.toLocaleString("en-IN")}</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
