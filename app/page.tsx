import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Fraunces } from "next/font/google";
import { BadgeCheck, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVideo } from "@/components/landing/hero-video";
import { HeroShell } from "@/components/landing/hero-shell";
import { ScrollStory, type Act } from "@/components/landing/scroll-story";
import { Reveal } from "@/components/landing/reveal";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});
const display = "[font-family:var(--font-fraunces)]";

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export const metadata = {
  title: `${PLATFORM} — Consent-first AI endorsements`,
  description:
    "Creators license verified AI replicas of themselves. Brands get endorsement videos that are consent-checked, rule-checked and provenance-signed — before any money moves.",
};

const acts: Act[] = [
  {
    n: "01", kicker: "Protect", chip: "Step 1 · Your likeness on the record",
    video: "/videos/clip2.mp4", poster: "/videos/clip2-poster.jpg",
    title: "First, your face and voice go on the record.",
    body: "You record a short consent video in your own voice. An independent deepfake detector confirms it's really you, and it's locked into your public registry page. From that moment the world can see exactly what you've authorised — and anything else is a fake anyone can report.",
  },
  {
    n: "02", kicker: "License", chip: "Step 2 · Brands follow your rules",
    video: "/videos/clip3.mp4", poster: "/videos/clip3-poster.jpg",
    title: "Brands must play by your rules to use you.",
    body: "A brand writes its script first. Our AI checks it against your personal no-go list — politics, alcohol, rival brands, anything you've banned — before the brand can even pay. A blocked script is never filmed and never charged.",
  },
  {
    n: "03", kicker: "Approve", chip: "Step 3 · The real approval screen",
    title: "Nothing is released until you tap approve.",
    body: "You get a private review link — open it on your phone, laptop, wherever you are. You see a watermarked preview, then approve it, ask for changes, or decline. The clean video stays locked until you say yes. We never auto-approve: if you stay silent, nothing goes out.",
  },
  {
    n: "04", kicker: "Prove", chip: "Step 4 · Proof sealed in the file",
    video: "/videos/clip4.mp4", poster: "/videos/clip4-poster.jpg",
    title: "Every released video carries its own proof.",
    body: "Your approval, the license and the script are cryptographically sealed inside the video file itself (C2PA Content Credentials). Anyone can check any clip in one click on our verify page. Fakes can't fake this.",
  },
];

export default function Landing() {
  return (
    <div className={`${fraunces.variable} min-h-dvh bg-zinc-950 text-zinc-50`}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight">
            <LogoMark className="size-8" />
            {PLATFORM}
          </div>
          <nav className="flex items-center gap-4">
            {/* ONE browse link, not three. Stars / Actors / Marketplace were
                three doors onto overlapping things, which forces a first-time
                visitor to guess the difference before they know what we do.
                Both other surfaces stay one click away: the hero CTA row links
                to the registry and the scanner, and the footer carries all five. */}
            <Link href="/marketplace" className="hidden text-sm text-zinc-300 hover:text-white sm:block">Marketplace</Link>
            <Button render={<Link href="/login" />} nativeButton={false} variant="ghost"
              className="text-zinc-300 hover:bg-white/10 hover:text-white">
              Sign in
            </Button>
            <Button render={<Link href="/signup" />} nativeButton={false}
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
              Get started
            </Button>
          </nav>
        </div>
      </header>

      {/* ── Hero: full-bleed particle silhouette, scroll-reactive ── */}
      <HeroShell>
        <div aria-hidden className="absolute inset-0 will-change-transform"
          style={{ transform: "scale(calc(1 + var(--hero-p) * 0.18))", opacity: "calc(1 - var(--hero-p) * 0.45)" }}>
          <HeroVideo src="/videos/clip1.mp4" poster="/videos/clip1-poster.jpg" />
        </div>
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/60 to-zinc-950/20" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-zinc-950 to-transparent" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pt-16 will-change-transform"
          style={{ transform: "translateY(calc(var(--hero-p) * -56px))", opacity: "calc(1 - var(--hero-p) * 0.9)" }}>
          <p className="rise rise-1 text-[13px] font-medium uppercase tracking-[0.22em] text-emerald-400">
            Protect &middot; License &middot; Prove &mdash; India&apos;s likeness registry
          </p>
          <h1 className={`${display} rise rise-2 mt-5 max-w-2xl text-balance text-5xl font-medium leading-[1.03] tracking-tight sm:text-7xl`}>
            Your face. Your voice.{" "}
            <em className="text-emerald-400">Your rules.</em>
          </h1>
          <p className="rise rise-3 mt-6 max-w-xl text-pretty text-lg leading-relaxed text-zinc-300 sm:text-xl">
            We protect your face and voice from AI misuse. Brands can license them for
            official AI videos, made by your rules —{" "}
            <span className="font-semibold text-white">
              and nothing is released until you personally approve it.
            </span>
          </p>
          <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
            <Button render={<Link href="/signup" />} nativeButton={false} size="lg"
              className="h-12 bg-emerald-500 px-6 text-base text-zinc-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400">
              Protect my likeness <ArrowRight className="size-4" />
            </Button>
            <Button render={<Link href="/marketplace" />} nativeButton={false} size="lg" variant="outline"
              className="h-12 border-zinc-600 bg-zinc-950/40 px-6 text-base text-zinc-100 backdrop-blur hover:bg-zinc-900 hover:text-white">
              I&apos;m a brand — browse stars
            </Button>
            <Link href="/inspect" className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline">
              Just checking if a video is real? Verify it here.
            </Link>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center">
          <ChevronDown className="size-6 animate-bounce text-zinc-500" aria-hidden />
        </div>
      </HeroShell>

      {/* ── Trust strip ────────────────────────────────────── */}
      <section className="border-y border-zinc-900 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-5 text-sm text-zinc-300">
          <span>Follows India&apos;s IT Rules 2026</span><span aria-hidden>·</span>
          <span>On-camera, voice-verified consent</span><span aria-hidden>·</span>
          <span>Independent deepfake screening</span><span aria-hidden>·</span>
          <span>Tamper-proof video labels (C2PA)</span><span aria-hidden>·</span>
          <span>Change your mind? One click stops everything</span>
        </div>
      </section>

      {/* ── Scroll story ───────────────────────────────────── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-5 pb-4">
          <h2 className={`${display} text-3xl font-medium tracking-tight sm:text-5xl`}>
            How it works
          </h2>
          <p className="mt-3 max-w-xl text-lg text-zinc-400">
            Four steps: protect the likeness, license it on the star&apos;s terms,
            approve every video personally, and seal the proof inside the file.
          </p>
        </div>
        <ScrollStory acts={acts} />
        <div className="mx-auto mt-16 max-w-6xl px-5">
          <Reveal>
            <p className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-5 py-4 text-[15px] leading-relaxed text-emerald-200">
              <span className="font-semibold text-emerald-300">And if the star changes their mind?</span>{" "}
              One click revokes consent — the listing comes down and every generation stops, instantly.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Why now ────────────────────────────────────────── */}
      <section className="border-t border-zinc-900 bg-zinc-900/30">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal>
            <p className="text-[13px] font-medium uppercase tracking-[0.22em] text-emerald-400">Why now</p>
            <h2 className={`${display} mt-3 max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl`}>
              Consent just became the law, not a courtesy.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              { t: "IT Rules 2026", b: "Since February 2026, India mandates AI labels, embedded provenance and 2–3 hour takedowns for synthetic media. We ship all three out of the box." },
              { t: "Personality rights", b: "Indian courts — Anil Kapoor (2023), Arijit Singh (2024) — treat unconsented AI likeness as actionable. Provable consent is now something brands must buy." },
              { t: "The open gap", b: "Tavus, HeyGen and D-ID sell generation to everyone. Nobody owns the rights layer — consent, rules, licensing, revocation. That ledger is the moat." },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 120}>
                <h3 className={`${display} text-xl font-medium text-zinc-50`}>{c.t}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-300">{c.b}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── For creators / brands ──────────────────────────── */}
      <section className="border-t border-zinc-900">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-24 sm:grid-cols-3">
          {[
            { role: "For celebrities", points: ["Your public page shows the world what's real", "Set rules brands can never cross", "Approve every video yourself — on any device", "Change your mind? One click stops everything"] },
            { role: "For brands", points: ["Official star endorsements in days, not months", "Know a script passes before you pay", "Every video is labelled, signed and verifiable"] },
            { role: "For fans", points: ["Follow verified stars, see only real approved videos", "Check any suspicious clip in one click", "Vote for the next star we should protect"] },
          ].map((col, i) => (
            <Reveal key={col.role} delay={i * 120}>
              <h3 className={`${display} text-2xl font-medium text-zinc-50`}>{col.role}</h3>
              <ul className="mt-5 space-y-3.5">
                {col.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-base text-zinc-200">
                    <BadgeCheck className="mt-1 size-4.5 shrink-0 text-emerald-400" /> {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Roadmap: cinematic scenes ───────────────────────
          A REAL clip, not a mockup: Arjun's consented HeyGen avatar rendered
          through Seedance 2 in HeyGen Studio on 2026-08-04. It is labelled as
          roadmap rather than product because HeyGen exposes no API for it —
          14 endpoints probed, every cinematic route 404s — so we cannot drive
          it from the platform yet. Showing it as "shipping today" would be the
          one lie this product cannot afford. */}
      <section className="border-t border-zinc-900 bg-zinc-950">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-400">
              On the roadmap
            </span>
            <h2 className={`${display} mt-4 max-w-2xl text-balance text-3xl font-medium tracking-tight sm:text-4xl`}>
              Beyond the talking head — full cinematic scenes.
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-300">
              Today we deliver studio-grade spokesperson video. Next: the same consented
              likeness directed like a film shoot — camera moves, lighting, staging. The clip
              below is real, made from a genuinely consented avatar. The consent layer,
              approval flow and provenance seal would work exactly the same way.
            </p>
          </Reveal>

          <Reveal delay={140}>
            <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <figure className="overflow-hidden rounded-2xl border border-zinc-800 bg-black shadow-2xl">
                <video
                  src="/videos/seedance-cinematic-demo.mp4"
                  controls playsInline preload="metadata"
                  className="aspect-video w-full"
                />
                <figcaption className="border-t border-zinc-800 px-4 py-3 text-xs leading-relaxed text-zinc-400">
                  15 seconds · rendered from a consented likeness · not yet available through
                  the Consentry pipeline
                </figcaption>
              </figure>

              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-6">
                <p className="text-sm font-semibold text-amber-300">Why this is roadmap, not product</p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  The cinematic engine is only reachable through a creative suite&apos;s own
                  interface — there is no API to call. Until there is, a brand cannot order
                  one of these through Consentry, so we do not sell it.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                  Everything that makes it <span className="text-white">safe</span> is already
                  built: recorded consent, published rules, the AI gate, per-video approval,
                  the watermark and the C2PA seal. Only the render step is missing.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────── */}
      <section className="border-t border-zinc-900 bg-gradient-to-b from-zinc-950 to-emerald-950/30">
        <Reveal>
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-7 px-5 py-20 sm:flex-row sm:items-center sm:justify-between">
            <h2 className={`${display} max-w-xl text-balance text-3xl font-medium tracking-tight sm:text-4xl`}>
              The consent layer for synthetic media starts here.
            </h2>
            <Button render={<Link href="/signup" />} nativeButton={false} size="lg"
              className="h-12 shrink-0 bg-emerald-500 px-6 text-base text-zinc-950 hover:bg-emerald-400">
              Get started <ArrowRight className="size-4" />
            </Button>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-5 py-8 text-sm text-zinc-400 sm:flex-row sm:items-center">
          <span>© 2026 {PLATFORM}. Investor demo build — payments run in test mode.</span>
          <span className="flex flex-wrap items-center gap-4">
            <Link href="/celebrities" className="text-zinc-300 hover:text-emerald-400">Verified stars</Link>
            <Link href="/request-a-star" className="text-zinc-300 hover:text-emerald-400">Request a star</Link>
            <Link href="/actors" className="text-zinc-300 hover:text-emerald-400">Actor Library</Link>
            <Link href="/inspect" className="text-zinc-300 hover:text-emerald-400">Verify a video</Link>
            <Link href="/marketplace" className="text-zinc-300 hover:text-emerald-400">Marketplace</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
