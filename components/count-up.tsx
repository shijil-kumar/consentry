"use client";

import { useEffect, useRef, useState } from "react";

// Animated number: renders the final value on the server (SEO + no-JS safe),
// then counts up when it first scrolls into view. Trigger is a throttled
// scroll listener, not IntersectionObserver — IO misfires in some embedded
// browsers (same lesson as scroll-story.tsx). Any failure path shows the
// real value; reduced-motion skips the animation entirely.
export function CountUp({ value, className = "" }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let started = false;

    const start = () => {
      started = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      const t0 = performance.now();
      const dur = 900;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(Math.round(value * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      setDisplay(0);
      raf = requestAnimationFrame(tick);
    };
    const inView = () => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.95 && r.bottom > 0;
    };
    const check = () => { pending = null; if (!started && inView()) start(); };
    const onScroll = () => { if (!pending) pending = setTimeout(check, 90); };

    if (window.innerHeight > 0 && inView()) start();
    else {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) clearTimeout(pending);
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return <span ref={ref} className={className}>{display.toLocaleString("en-IN")}</span>;
}
