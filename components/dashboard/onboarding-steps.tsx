import Link from "next/link";
import { Check, ArrowRight, PartyPopper } from "lucide-react";

export interface OnboardStep {
  title: string;
  desc: string;
  done: boolean;
  href: string;
  cta: string;
}

// Staged onboarding checklist (21st.dev "onboarding stages" pattern, built in
// our stack): progress bar + numbered steps; the first incomplete step is
// highlighted with its call-to-action. Fully server-rendered.
export function OnboardingSteps({ steps, title }: { steps: OnboardStep[]; title: string }) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  const nextIdx = steps.findIndex((s) => !s.done);

  if (nextIdx === -1) {
    return (
      <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <PartyPopper className="size-4.5 text-emerald-600" />
        <span className="font-medium">You&apos;re fully set up.</span> Everything below is live.
      </div>
    );
  }

  return (
    <div className="mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50/80 via-card to-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs font-medium text-muted-foreground">{done} of {steps.length} done · {pct}%</p>
      </div>
      <div className="mx-5 mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <ol className="grid gap-1 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const isNext = i === nextIdx;
          return (
            <li key={s.title}
              className={`rounded-xl p-3 transition-colors ${isNext ? "bg-card shadow-sm ring-1 ring-emerald-300" : ""}`}>
              <div className="flex items-center gap-2.5">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  s.done ? "bg-emerald-500 text-white" : isNext ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                  {s.done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <p className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through decoration-emerald-400/60" : ""}`}>
                  {s.title}
                </p>
              </div>
              <p className="mt-1.5 pl-8.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
              {isNext && (
                <Link href={s.href}
                  className="mt-2 ml-8.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600">
                  {s.cta} <ArrowRight className="size-3" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
