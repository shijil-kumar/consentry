import { ShieldCheck, ThumbsUp, MessageSquareText, XCircle, Clock, Play } from "lucide-react";

// A faithful, pure-CSS miniature of the real /approve/[token] screen. Used in
// the landing scroll story so visitors see the actual product moment — the
// celebrity's 2-tap approval — instead of an abstract visual.
export function ApprovalPhoneMockup() {
  return (
    <div className="phone-float relative mx-auto w-[240px] select-none rounded-[2.2rem] border border-zinc-700 bg-zinc-950 p-2.5 shadow-2xl shadow-emerald-500/10">
      {/* notch */}
      <div className="absolute left-1/2 top-2.5 h-4 w-20 -translate-x-1/2 rounded-full bg-zinc-900" />
      <div className="overflow-hidden rounded-[1.7rem] bg-zinc-900">
        {/* status area */}
        <div className="flex items-center justify-between px-4 pb-1 pt-6 text-[9px] text-zinc-500">
          <span>21:47</span>
          <span className="flex items-center gap-1 font-medium text-emerald-400">
            <ShieldCheck className="size-2.5" /> Consentry
          </span>
        </div>
        <div className="space-y-2 px-3 pb-4">
          {/* request header */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[9px] text-zinc-500">Request from</p>
              <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-medium text-amber-400">
                <Clock className="size-2" /> 72h · never auto-approved
              </span>
            </div>
            <p className="text-[13px] font-semibold text-zinc-100">Acme Wellness</p>
            <p className="text-[10px] font-medium text-emerald-400">₹25,000 license · v1</p>
          </div>
          {/* watermarked preview */}
          <div className="relative flex aspect-video items-center justify-center rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-800 to-zinc-900">
            <span className="flex size-8 items-center justify-center rounded-full bg-white/10 backdrop-blur">
              <Play className="ml-0.5 size-3.5 text-white" />
            </span>
            <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[7px] font-medium uppercase tracking-wider text-white/60">
              Preview — made with Consentry
            </span>
          </div>
          {/* actions */}
          <button tabIndex={-1} aria-hidden className="approve-glow flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 text-[11px] font-semibold text-zinc-950">
            <ThumbsUp className="size-3" /> Approve &amp; release
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <span className="flex h-7 items-center justify-center gap-1 rounded-lg border border-zinc-700 text-[9px] font-medium text-zinc-300">
              <MessageSquareText className="size-2.5" /> Changes
            </span>
            <span className="flex h-7 items-center justify-center gap-1 rounded-lg border border-red-500/40 text-[9px] font-medium text-red-400">
              <XCircle className="size-2.5" /> Decline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
