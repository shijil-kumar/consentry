"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";

// Full-bleed hero video: autoplay muted loop, pauses offscreen, honors
// prefers-reduced-motion (poster only), poster fallback while loading.
export function HeroVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const v = ref.current;
    if (!v || reduced) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); },
      { threshold: 0.15 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  if (reduced) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />;
  }
  return (
    <video ref={ref} src={src} poster={poster} muted loop playsInline autoPlay
      preload="metadata" aria-hidden
      className="absolute inset-0 h-full w-full object-cover" />
  );
}
