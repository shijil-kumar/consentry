"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { ApprovalPhoneMockup } from "./approval-phone";

export interface Act {
  n: string;
  kicker: string;
  chip: string; // short label shown ON the media so visuals are never ambiguous
  title: string;
  body: string;
  video?: string; // absent → render the real-product approval mockup instead
  poster?: string;
}

// Scrollytelling: on desktop a sticky media panel crossfades between the act
// visuals while the copy scrolls past; on mobile each act stacks with its own
// inline media. Native scroll only — no hijacking; reduced-motion gets posters.
export function ScrollStory({ acts }: { acts: Act[] }) {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Track which step block is nearest the viewport center. A plain scroll
  // listener (rAF-throttled) rather than IntersectionObserver: percentage
  // rootMargins are flaky in some embedded browsers, and this is cheap.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      pending = null;
      const mid = window.innerHeight / 2;
      let best = 0, bestDist = Infinity;
      stepRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setActive((a) => (a === best ? a : best));
    };
    // setTimeout throttle (not rAF): rAF stalls in some embedded/background
    // browser contexts; a 90ms tick is imperceptible and always fires.
    const onScroll = () => { if (!pending) pending = setTimeout(update, 90); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) clearTimeout(pending);
    };
  }, []);

  // Only the active video plays
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && !reduced) v.play().catch(() => {});
      else v.pause();
    });
  }, [active, reduced]);

  const media = (a: Act, i: number, visible: boolean) =>
    !a.video ? (
      <div key={a.n} aria-hidden={!visible}
        className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-emerald-950/40 transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`}>
        <div className="origin-center scale-[0.82]"><ApprovalPhoneMockup /></div>
      </div>
    ) : reduced ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={a.n} src={a.poster} alt=""
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`} />
    ) : (
      <video key={a.n} ref={(el) => { videoRefs.current[i] = el; }}
        src={a.video} poster={a.poster} muted loop playsInline preload="metadata" aria-hidden
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`} />
    );

  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* Desktop: sticky media + scrolling copy */}
      <div className="hidden gap-12 lg:grid lg:grid-cols-2">
        <div className="relative">
          <div className="sticky top-24 aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-emerald-950/40">
            {acts.map((a, i) => media(a, i, i === active))}
            {/* step label chip — anchors abstract visuals to the step being read */}
            <span className="absolute left-4 top-4 rounded-full border border-zinc-700/80 bg-zinc-950/80 px-3 py-1 text-xs font-medium text-zinc-100 backdrop-blur">
              {acts[active].chip}
            </span>
            <div className="absolute bottom-4 left-4 flex gap-1.5">
              {acts.map((a, i) => (
                <span key={a.n} className={`h-1 rounded-full transition-all duration-500 ${i === active ? "w-8 bg-emerald-400" : "w-4 bg-zinc-700"}`} />
              ))}
            </div>
          </div>
        </div>
        <div>
          {acts.map((a, i) => (
            <div key={a.n} ref={(el) => { stepRefs.current[i] = el; }}
              className="flex min-h-[70vh] flex-col justify-center py-16">
              <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-emerald-400">
                {a.n} — {a.kicker}
              </p>
              <h3 className="mt-3 max-w-md text-3xl font-medium tracking-tight text-zinc-50 [font-family:var(--font-fraunces)] sm:text-4xl">
                {a.title}
              </h3>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-zinc-300">{a.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: stacked acts */}
      <div className="space-y-16 lg:hidden">
        {acts.map((a) => (
          <div key={a.n}>
            <div className={`relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 ${a.video ? "aspect-video" : ""}`}>
              {!a.video ? (
                <div className="flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-emerald-950/40 py-8">
                  <ApprovalPhoneMockup />
                </div>
              ) : reduced ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.poster} alt="" className="h-full w-full object-cover" />
              ) : (
                <video src={a.video} poster={a.poster} muted loop playsInline autoPlay
                  preload="metadata" aria-hidden className="h-full w-full object-cover" />
              )}
              <span className="absolute left-3 top-3 rounded-full border border-zinc-700/80 bg-zinc-950/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-100 backdrop-blur">
                {a.chip}
              </span>
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-emerald-400">
              {a.n} — {a.kicker}
            </p>
            <h3 className="mt-2 text-2xl font-medium tracking-tight text-zinc-50 [font-family:var(--font-fraunces)]">
              {a.title}
            </h3>
            <p className="mt-2 text-base leading-relaxed text-zinc-300">{a.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
