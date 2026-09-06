import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Fraunces } from "next/font/google";
import { supabaseServer } from "@/lib/supabase/server";
import { PublicHeader } from "@/components/public-header";
import { FollowButton } from "@/components/follow-button";
import { ReportButton } from "@/components/report-button";
import { CountUp } from "@/components/count-up";
import {
  BadgeCheck, ShieldCheck, Fingerprint, FileCheck2, ShieldAlert, Eye, Pencil, ArrowRight,
} from "lucide-react";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["400", "500", "600"] });
const display = "[font-family:var(--font-fraunces)]";
const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Platform";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const supabase = await supabaseServer();
  const { data: l } = await supabase
    .from("public_listings")
    .select("display_name, avatar_url")
    .eq("handle", handle).maybeSingle();
  if (!l) return { title: "Registry" };
  return {
    title: `${l.display_name} — Verified likeness registry`,
    description: `Every AI video ${l.display_name} has actually approved. Anything claiming to be their AI endorsement that is not listed here was not approved.`,
    openGraph: l.avatar_url ? { images: [{ url: l.avatar_url }] } : undefined,
  };
}

// /c/[handle] — the VERIFIED LIKENESS REGISTRY page. One component tree:
// the public sees the canonical "everything not listed here is unauthorized"
// anchor; the logged-in owner sees the same page plus an owner layer.
// Private data is fetched ONLY when the viewer is the owner — it never enters
// the public payload.
export default async function CelebrityPage({
  params, searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { handle } = await params;
  const { view } = await searchParams;
  const supabase = await supabaseServer();

  // Public-safe data only (anon-readable views + aggregate counts)
  const { data: listing } = await supabase
    .from("public_listings")
    .select("id, creator_id, title, bio, display_name, handle, avatar_url, allowed_categories, consent_verified, consent_verified_at, kyc_verified, is_demo")
    .eq("handle", handle).maybeSingle();
  if (!listing) notFound();

  const [{ data: gens }, { data: counts }, { data: takedowns }, { data: ruleRows }] = await Promise.all([
    supabase.from("public_registry").select("*").eq("handle", handle).limit(12),
    supabase.from("public_follow_counts").select("celebrity_id, followers"),
    // real enforcement numbers — this stat used to be a hardcoded 0 while the
    // creator dashboard and admin desk showed live reports
    supabase.from("public_takedown_counts")
      .select("creator_id, actioned").eq("creator_id", listing.creator_id).maybeSingle(),
    // The star's own no-go rules, published verbatim. Competitor research
    // (2026-08-01): opaque moderation is the dominant 1-star theme against the
    // avatar platforms — buyers get refusals with no stated rule, talent gets
    // uses they never sanctioned. Publishing the rule set makes both sides'
    // contract inspectable BEFORE any script is written; the gate cites these
    // same clauses when it blocks.
    supabase.from("listing_prohibited_uses")
      .select("custom_note, policy_clauses(code, title, description)")
      .eq("listing_id", listing.id),
  ]);
  const rules = (ruleRows ?? [])
    .map((r) => ({ ...(r.policy_clauses as unknown as { code: string; title: string; description: string }), note: r.custom_note }))
    .filter((r, i, a) => r?.code && a.findIndex((x) => x.code === r.code) === i)
    .sort((a, b) => a.code.localeCompare(b.code));

  // From the LISTING, not from delivered content: deriving it from the registry
  // meant any star without a delivered video had no id, so the Follow button —
  // the core fan action — silently disappeared on 5 of 6 pages.
  const celebId = listing.creator_id as string;

  const { data: { user } } = await supabase.auth.getUser();
  const forcePublic = view === "public";
  let isOwner = false;
  let ownerData: { pendingApprovals: number; alerts: number } | null = null;
  let following = false;
  if (user) {
    const { data: me } = await supabase.from("profiles").select("id, handle, org_id").eq("id", user.id).single();
    isOwner = me?.handle === handle && !forcePublic;
    if (isOwner && me) {
      const [{ count: pending }, { count: alerts }] = await Promise.all([
        supabase.from("generations").select("id", { count: "exact", head: true })
          .eq("creator_org_id", me.org_id).eq("status", "celebrity_review"),
        supabase.from("reports").select("id", { count: "exact", head: true })
          .in("status", ["open", "reviewing"]),
      ]);
      ownerData = { pendingApprovals: pending ?? 0, alerts: alerts ?? 0 };
    }
    if (celebId) {
      const { data: f } = await supabase.from("follows")
        .select("celebrity_id").eq("follower_id", user.id).eq("celebrity_id", celebId).maybeSingle();
      following = !!f;
    }
  }
  const followerCount = celebId
    ? (counts ?? []).find((c) => c.celebrity_id === celebId)?.followers ?? 0
    : 0;

  const activeLicenses = (gens ?? []).filter((g) => g.license_status === "active").length;
  const deliveredCount = (gens ?? []).filter((g) => g.status === "delivered").length;
  const protectedSince = listing.consent_verified_at
    ? new Date(listing.consent_verified_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : null;

  return (
    <div className={`${fraunces.variable} min-h-dvh bg-zinc-950 text-zinc-100`}>
      {/* Shared PublicHeader, not a hand-rolled one: this page had its own header
          that always pointed the logo at "/" and never showed the session, so a
          signed-in creator viewing their own registry looked signed OUT and lost
          their way back into the app. Every public page now uses the same header,
          which reflects who you are. */}
      <PublicHeader width="max-w-5xl">
        <Link href="/marketplace" className="text-zinc-300 hover:text-white">Marketplace</Link>
        <Link href="/inspect" className="hidden text-zinc-300 hover:text-white sm:block">Verify a video</Link>
      </PublicHeader>

      {/* Owner banner — never rendered for the public */}
      {isOwner && ownerData && (
        <div className="mx-auto max-w-5xl px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3">
            <p className="flex items-center gap-2 text-sm text-emerald-200">
              <Eye className="size-4" /> This is your page as the owner.
              <span className="font-semibold">{ownerData.pendingApprovals} approval{ownerData.pendingApprovals === 1 ? "" : "s"} waiting</span>
              · {ownerData.alerts} protection alert{ownerData.alerts === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2">
              <Link href="/creator/requests" className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400">
                Review approvals
              </Link>
              <Link href={`/c/${handle}?view=public`} className="rounded-full border border-emerald-500/40 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10">
                View as public
              </Link>
            </div>
          </div>
        </div>
      )}
      {forcePublic && user && (
        <div className="mx-auto max-w-5xl px-5">
          <p className="rounded-xl bg-zinc-900 px-4 py-2 text-center text-xs text-zinc-400">
            Public view — this is exactly what visitors see. <Link href={`/c/${handle}`} className="text-emerald-400">Back to owner view</Link>
          </p>
        </div>
      )}

      {/* ── Hero: the registry identity ── */}
      <section className="mx-auto max-w-5xl px-5 pb-10 pt-10">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl border border-emerald-500/30 bg-zinc-900 sm:size-32">
            <Image src={listing.avatar_url ?? "/actors/a1.jpg"} alt={listing.display_name} fill className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className={`${display} text-3xl font-medium tracking-tight sm:text-4xl`}>{listing.display_name}</h1>
              {listing.kyc_verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-400">
                  <BadgeCheck className="size-3.5" /> Identity verified
                </span>
              )}
              {listing.is_demo && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400">DEMO</span>
              )}
            </div>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-300">{listing.bio ?? listing.title}</p>
            {protectedSince && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-400">
                <ShieldCheck className="size-4" /> Protected by {PLATFORM} since {protectedSince}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <FollowButton celebrityId={celebId} handle={handle} initialFollowing={following}
              initialCount={followerCount} signedIn={!!user} />
            <Link href={`/marketplace/${listing.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-white">
              License this likeness <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Registry panel: the ledger speaks ── */}
      <section className="border-y border-zinc-900 bg-zinc-900/30">
        <div className="mx-auto grid max-w-5xl gap-px overflow-hidden px-5 py-6 sm:grid-cols-3">
          {[
            { icon: FileCheck2, label: "Active licenses", value: activeLicenses, tint: "text-emerald-400" },
            { icon: Fingerprint, label: "Authorised videos on record", value: deliveredCount, tint: "text-sky-400" },
            { icon: ShieldAlert, label: "Takedowns actioned", value: takedowns?.actioned ?? 0, tint: "text-amber-400" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-3 py-2">
              <s.icon className={`size-5 ${s.tint}`} />
              <div>
                <p className="text-2xl font-semibold tabular-nums"><CountUp value={s.value} /></p>
                <p className="text-xs text-zinc-400">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mx-auto max-w-5xl px-5 pb-5 text-xs leading-relaxed text-zinc-500">
          This is the authorised-content registry for {listing.display_name}&apos;s AI likeness.
          Anything claiming to be their AI endorsement that is <span className="font-medium text-zinc-300">not listed here</span> was
          not approved through {PLATFORM}.
        </p>
      </section>

      {/* ── The star's published rules ── */}
      {rules.length > 0 && (
        <section className="mx-auto max-w-5xl px-5 pt-12">
          <h2 className={`${display} text-2xl font-medium tracking-tight`}>
            {listing.display_name.split(" ")[0]}&apos;s rules — public, and enforced by the gate
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Every script a brand submits is checked against these exact rules <span className="font-medium text-zinc-200">before
            anything is rendered or paid for</span>. A blocked script is told which rule it broke; an approved
            video was approved against this list, on the record.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rules.map((r) => (
              <div key={r.code} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                  <ShieldCheck className="size-4 shrink-0 text-red-400/80" /> No {r.title.toLowerCase().replace(/^no /, "")}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{r.note ?? r.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Authorised content gallery ── */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        <h2 className={`${display} text-2xl font-medium tracking-tight`}>Authorised brand content</h2>
        {(gens ?? []).length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(gens ?? []).map((g) => (
              <Link key={g.generation_id} href={`/verify/${g.generation_id}`}
                className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{g.buyer_org_name ?? "Brand"}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    g.license_status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>
                    {g.license_status === "active" ? "License active" : "License " + g.license_status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Approved {g.delivered_at ? new Date(g.delivered_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </p>
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <ShieldCheck className="size-3.5" /> Provenance sealed · tap to verify
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No authorised brand content yet — which itself is the point: anything out there
            claiming to be this likeness is unauthorised.
          </p>
        )}
      </section>

      {/* ── Report CTA ── */}
      <section className="border-t border-zinc-900 bg-zinc-900/30">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-5 py-10 sm:flex-row sm:items-center">
          <div>
            <h3 className={`${display} text-xl font-medium`}>Seen a suspicious video of {listing.display_name}?</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Report it — impersonation reports run on a 2-hour takedown clock.
            </p>
          </div>
          {(gens ?? [])[0]?.generation_id
            ? <ReportButton generationId={(gens ?? [])[0].generation_id} />
            : <Link href="/inspect" className="rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-white">Verify a video instead</Link>}
        </div>
      </section>

      <footer className="border-t border-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6 text-xs text-zinc-500">
          <span>© 2026 {PLATFORM} · Verified likeness registry</span>
          <Link href="/celebrities" className="text-zinc-400 hover:text-emerald-400">All celebrities</Link>
        </div>
      </footer>
      {isOwner && (
        <Link href="/creator/listing"
          className="fixed bottom-6 right-6 flex size-12 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 shadow-lg hover:bg-emerald-400"
          aria-label="Edit your page">
          <Pencil className="size-5" />
        </Link>
      )}
    </div>
  );
}
