"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Scroll-reveal with a guaranteed fallback: server render is fully visible;
// only after hydration do below-viewport elements get hidden, and a plain
// throttled scroll listener reveals them. No IntersectionObserver — IO
// misfires in some embedded browsers (same lesson as scroll-story.tsx).
// If JS never runs, nothing is ever hidden. Respects prefers-reduced-motion.
export function Reveal({ children, delay = 0, className = "" }: {
  children: ReactNode;
  delay?: number; // ms stagger
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"initial" | "hidden" | "shown">("initial");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const inView = () =>
      el.getBoundingClientRect().top < window.innerHeight * 0.9;
    if (window.innerHeight === 0 || inView()) return; // visible (or unmeasurable) → leave as-is
    setState("hidden");

    let pending: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const reveal = () => {
      done = true;
      setState("shown");
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    const check = () => { pending = null; if (!done && inView()) reveal(); };
    const onScroll = () => { if (!pending) pending = setTimeout(check, 90); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Belt-and-suspenders: never stay hidden longer than 8s regardless.
    const t = setTimeout(() => { if (!done) reveal(); }, 8000);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) clearTimeout(pending);
      clearTimeout(t);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-reveal={state}
      className={`${className} transition-all duration-700 ease-out ${
        state === "hidden" ? "translate-y-6 opacity-0" : "translate-y-0 opacity-100"
      }`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
