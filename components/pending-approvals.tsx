"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, MessageCircle, ArrowRight, PartyPopper } from "lucide-react";

interface Approval {
  generation_id: string;
  brand: string;
  script_excerpt: string;
  version: number;
  review_deadline: string | null;
  token: string | null;
}

// The celebrity's money row: pending preview approvals, presented as the
// WhatsApp message they'd receive in production (simulated for the demo —
// the magic link itself is fully real).
export function PendingApprovals() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // async boundary: current time is only knowable client-side (hydration)
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    fetch("/api/my-approvals")
      .then((r) => r.json())
      .then((j) => setApprovals(j.approvals ?? []))
      .catch(() => setApprovals([]));
  }, []);

  if (approvals === null) {
    return <div className="h-24 animate-pulse rounded-2xl border bg-muted/40" />;
  }
  if (approvals.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <PartyPopper className="size-4 text-emerald-600" /> No videos waiting for your approval. Nothing releases without you.
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {approvals.map((a) => {
        const hoursLeft = a.review_deadline && now
          ? Math.max(0, Math.round((new Date(a.review_deadline).getTime() - (now ?? 0)) / 3600000))
          : null;
        return (
          <div key={a.generation_id} className="overflow-hidden rounded-2xl border shadow-sm">
            {/* Simulated WhatsApp delivery of the very real magic link */}
            <div className="flex items-center gap-2 bg-[#075E54] px-4 py-2 text-xs font-medium text-white">
              <MessageCircle className="size-3.5" /> WhatsApp · simulated for the demo — the link is real
            </div>
            <div className="bg-[#ECE5DD] p-3">
              <div className="max-w-[95%] rounded-xl rounded-tl-none bg-white p-3 shadow-sm">
                <p className="text-sm font-semibold text-zinc-900">
                  {a.brand} wants your approval {a.version > 1 ? `(v${a.version})` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-600">&ldquo;{a.script_excerpt}…&rdquo;</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  {hoursLeft !== null && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <Clock className="size-3" /> {hoursLeft}h left · never auto-approved
                    </span>
                  )}
                  {a.token ? (
                    <Link href={`/approve/${a.token}`}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                      Watch &amp; decide <ArrowRight className="size-3" />
                    </Link>
                  ) : (
                    <span className="text-xs text-zinc-500">Link refreshing…</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
