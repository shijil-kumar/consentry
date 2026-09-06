"use client";

// Guided progress visual used everywhere something takes time: each stage is
// named and explained, the active one pulses, completed ones tick. Turns every
// wait into a story a first-time visitor can follow.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

export interface ProcessStep {
  label: string;
  detail?: string;
  eta?: string;          // "usually 40-90s" — what normal looks like for this step
}

// mm:ss from a start timestamp, ticking every second.
function useElapsed(startedAt?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

// Total time in the pipeline, shown ONCE in the header. It deliberately does
// NOT sit next to a step's eta: "3:01" beside "typically 10-30 seconds" reads
// as overdue, when it is really the total across every step so far.
export function ElapsedBadge({ startedAt, label = "elapsed" }: { startedAt?: string | null; label?: string }) {
  const elapsed = useElapsed(startedAt);
  if (!elapsed) return null;
  return (
    <span className="rounded-full bg-background px-2 py-0.5 font-mono text-xs font-normal tabular-nums text-muted-foreground">
      {elapsed} {label}
    </span>
  );
}

export function ProcessSteps({ steps, active, done = false, tone = "emerald" }: {
  steps: ProcessStep[];
  active: number;        // index of the in-progress step
  done?: boolean;        // all complete
  tone?: "emerald" | "sky";
}) {
  const accent = tone === "emerald" ? "text-emerald-600" : "text-sky-600";
  const bar = tone === "emerald" ? "bg-emerald-500" : "bg-sky-500";
  return (
    <ol className="grid gap-0">
      {steps.map((s, i) => {
        const state = done || i < active ? "done" : i === active ? "active" : "todo";
        return (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 rounded ${state === "done" ? bar : "bg-border"}`} />
            )}
            <span className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              state === "done" ? `${bar} text-white`
              : state === "active" ? "border-2 border-current bg-background " + accent
              : "border-2 border-border bg-background text-muted-foreground"}`}>
              {state === "done" ? <Check className="size-3.5" />
                : state === "active" ? <Loader2 className="size-3.5 animate-spin" />
                : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-medium leading-tight ${state === "todo" ? "text-muted-foreground" : ""}`}>{s.label}</p>
              {s.detail && state !== "todo" && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
              )}
              {s.eta && state === "active" && (
                <p className="mt-0.5 text-xs text-muted-foreground">{s.eta}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
