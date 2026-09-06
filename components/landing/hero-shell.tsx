"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";

// Scroll-reactive hero: as the first viewport scrolls away, the background
// video slowly zooms (scale 1 → 1.18) and the copy drifts up and fades.
// Native scroll only — we just publish progress as a CSS variable; reduced
// motion disables the effect entirely.
export function HeroShell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      pending = null;
      const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
      el.style.setProperty("--hero-p", p.toFixed(3));
    };
    const onScroll = () => { if (!pending) pending = setTimeout(update, 32); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) clearTimeout(pending);
    };
  }, [reduced]);

  return (
    <section
      ref={ref}
      style={{ ["--hero-p" as string]: 0 }}
      className="relative flex min-h-dvh items-center overflow-hidden"
    >
      {children}
    </section>
  );
}
