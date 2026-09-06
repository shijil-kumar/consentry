import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { ReplicaCard, type AvatarSnapshot } from "@/components/replica-card";
import { RevokeConsentButton } from "@/components/revoke-consent";
import { pickConsent } from "@/lib/consent-status";
import { LiveLedger } from "@/components/live-ledger";
import { AuthenticityCheck, type Authenticity } from "@/components/authenticity-check";
import { EarningsChart } from "@/components/earnings-chart";
import { WelcomeBand } from "@/components/dashboard/welcome-band";
import { OnboardingSteps } from "@/components/dashboard/onboarding-steps";
import { StatCard } from "@/components/dashboard/stat-card";
import { PendingApprovals } from "@/components/pending-approvals";
import { AvatarViewsCard } from "@/components/dashboard/avatar-views-card";
import {
  Fingerprint, Video, ScrollText, Mic, ShieldAlert, ShieldCheck, Clock, ArrowRight,
  IndianRupee, FileCheck2, Inbox, Eye,
} from "lucide-react";


export const metadata = { title: "Creator Studio" };
interface ConsentRow {
  id: string;
  status: "pending" | "verified" | "revoked";
  content_hash: string;
  granted_at: string;
  voice_captcha: { verified?: boolean } | null;
  authenticity: Authenticity | null;
}
interface AuditRow { id: number; action: string; created_at: string }

const consentBadge = {
  pending: { label: "Pending verification", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: Clock },
  verified: { label: "Consent verified", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: ShieldCheck },
  revoked: { label: "Revoked", cls: "bg-red-500/15 text-red-600 border-red-500/30", icon: ShieldAlert },
} as const;

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const dynamic = "force-dynamic";

export default async function CreatorDashboard() {
  const { supabase, profile } = await requireProfile("creator");

  const [{ data: consents }, { data: avatars }, { data: audit }, { data: payouts }, { data: activeLic }, { count: reviewCount }, { data: usage }, { data: myListings }] =
    await Promise.all([
      supabase.from("consent_records")
        .select("id, status, content_hash, granted_at, voice_captcha, authenticity")
        .eq("org_id", profile.org_id)
        // Several, not one: a newer unverified take must not be mistaken for
        // the grant that is actually in force. See lib/consent-status.
        .order("created_at", { ascending: false }).limit(5).returns<ConsentRow[]>(),
      supabase.from("avatars")
        .select("id, status, provider, preview_video_url, error, consent_record_id")
        .eq("org_id", profile.org_id)
        .order("created_at", { ascending: false }).limit(1).returns<AvatarSnapshot[]>(),
      supabase.from("audit_log").select("id, action, created_at")
        .order("id", { ascending: false }).limit(12).returns<AuditRow[]>(),
      supabase.from("payouts").select("net_paise, status, created_at"),
      supabase.from("licenses").select("id, status").eq("creator_org_id", profile.org_id).eq("status", "active"),
      supabase.from("approval_requests").select("id", { count: "exact", head: true })
        .eq("creator_org_id", profile.org_id).eq("status", "needs_review"),
      supabase.from("license_details")
        .select("license_id, status, buyer_org_name, tier_name, amount_paise, expires_at")
        .eq("creator_org_id", profile.org_id).order("license_id", { ascending: false }).limit(8),
      // org-scoped: published listings are readable by ANY authenticated user
      // (marketplace), so an unscoped limit(1) reported another creator's
      // publish status on this creator's onboarding checklist.
      supabase.from("listings").select("status").eq("org_id", profile.org_id)
        .order("created_at", { ascending: false }).limit(1),
    ]);

  const { governing: consent, awaiting: newerTake } = pickConsent(consents);
  const avatar = avatars?.[0];
  const voiceVerified = consent?.voice_captcha?.verified === true;
  const earnings = (payouts ?? []).reduce((s, p) => s + (p.net_paise ?? 0), 0);

  return (
    <AppShell role="creator" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name}
        blurb="Your likeness, your rules — protection first, licensing on top, proof underneath.">
        {/* The public page only EXISTS once a listing is published — /c/[handle]
            reads public_listings. Linking unconditionally sent every new creator
            to a 404 on the one button that says "here is your page". */}
        {myListings?.some((l) => l.status === "published") && profile.handle ? (
          <Button render={<Link href={`/c/${profile.handle}`} />} nativeButton={false}
            className="bg-white text-emerald-700 hover:bg-emerald-50">
            <Eye className="size-4" /> View public page
          </Button>
        ) : (
          <Button render={<Link href="/creator/listing" />} nativeButton={false}
            className="bg-white text-emerald-700 hover:bg-emerald-50">
            <Eye className="size-4" /> Publish to get your public page
          </Button>
        )}
      </WelcomeBand>

      {/* THE money row: previews waiting for the celebrity's decision */}
      <div className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Inbox className="size-4 text-primary" /> Waiting for your approval
          {(reviewCount ?? 0) > 0 && (
            <Link href="/creator/requests" className="ml-auto text-xs font-medium text-primary">
              +{reviewCount} script{(reviewCount ?? 0) > 1 ? "s" : ""} in manual review
            </Link>
          )}
        </h2>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <PendingApprovals />
          <AvatarViewsCard />
        </div>
      </div>

      <OnboardingSteps title="Set up your creator business" steps={[
        { title: "Record your consent", desc: "A short on-camera recording — the foundation of everything.",
          done: !!consent, href: "/creator/consent", cta: "Record now" },
        { title: "Get it verified", desc: "Voice check + optional deepfake screen prove it's really you.",
          done: consent?.status === "verified", href: "/creator/consent", cta: "Finish verification" },
        { title: "Train your replica", desc: "Your digital twin is built from that consent footage.",
          done: avatar?.status === "ready", href: "/creator", cta: "Train below" },
        { title: "Publish your listing", desc: "Set prices and red lines; brands can then license you.",
          done: myListings?.[0]?.status === "published", href: "/creator/listing", cta: "Set up listing" },
      ]} />

      {/* stat row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={IndianRupee} label="Earnings (simulated)" value={inr(earnings)} tone="emerald">
          <div className="mt-2">
            <EarningsChart payouts={(payouts ?? []) as Array<{ net_paise: number; created_at: string }>} />
          </div>
        </StatCard>
        <StatCard icon={FileCheck2} label="Active licenses" value={String(activeLic?.length ?? 0)} tone="sky"
          hint="Brands currently allowed to generate with your replica" />
        <StatCard icon={Video} label="Replica status" value={avatar?.status ?? "none"} tone="violet"
          hint={avatar?.status === "ready" ? "Ready to generate" : "Train it from your consent recording"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="size-4 text-primary" /> Consent record
            </CardTitle>
            <CardDescription>The crown jewel — nothing generates without it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {consent ? (
              <>
                {(() => {
                  const b = consentBadge[consent.status];
                  return (
                    <Badge variant="outline" className={b.cls}>
                      <b.icon className="size-3.5" /> {b.label}
                    </Badge>
                  );
                })()}
                <div className="space-y-1.5 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mic className="size-3.5" /> Voice check:{" "}
                    <span className={voiceVerified ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                      {voiceVerified ? "phrase verified" : "not verified"}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Granted {new Date(consent.granted_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                    sha256:{consent.content_hash.slice(0, 32)}…
                  </p>
                </div>
                {consent.status !== "revoked" && (
                  <AuthenticityCheck consentId={consent.id} initial={consent.authenticity} />
                )}
                {newerTake && (
                  <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                    A newer recording is being checked. Your current consent above stays in force —
                    and your replica keeps working — until the new one is verified.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No consent on record yet. Record your on-camera consent to unlock replica
                training and marketplace listing.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button render={<Link href="/creator/consent" />} nativeButton={false} className="w-full">
              {consent ? "Record a new consent" : "Record consent"} <ArrowRight className="size-4" />
            </Button>
            {consent && consent.status === "verified" && <RevokeConsentButton consentId={consent.id} />}
          </CardFooter>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Video className="size-4 text-primary" /> AI replica
            </CardTitle>
            <CardDescription>Trained from your consent recording.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReplicaCard
              initialAvatar={avatar ?? null}
              consentId={consent?.id ?? null}
              consentStatus={consent?.status ?? null}
            />
          </CardContent>
          {avatar?.status === "ready" && (
            <CardFooter>
              <Button render={<Link href="/creator/listing" />} nativeButton={false} variant="outline" className="w-full">
                Edit marketplace listing <ArrowRight className="size-4" />
              </Button>
            </CardFooter>
          )}
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4 text-primary" /> Live ledger
            </CardTitle>
            <CardDescription>Hash-chained audit trail, updating live.</CardDescription>
          </CardHeader>
          <CardContent>
            <LiveLedger initial={audit ?? []} />
          </CardContent>
        </Card>
      </div>

      {/* Protections — collapsed by default to keep the page calm */}
      <details className="mt-6 rounded-xl border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <ShieldCheck className="size-4 text-primary" /> Protections on your likeness
          <span className="ml-auto text-xs font-normal text-muted-foreground">10 safeguards live · tap to expand</span>
        </summary>
        <div className="grid gap-x-8 gap-y-2.5 border-t px-6 py-4 sm:grid-cols-2">
          {[
            "On-camera consent, hashed + anchored in a tamper-evident ledger",
            "One-time spoken phrase blocks reused or synthetic footage",
            "Independent deepfake screening (Reality Defender)",
            "Your prohibited-use rules enforced by a 3-layer AI gate, pre-payment",
            "Manipulation/prompt-injection attempts auto-blocked (PP-INJ)",
            "Payment impossible without an approved script (database-enforced)",
            "Every video labelled + C2PA-sealed with your consent record",
            "Public verify + inspect pages prove any video in one click",
            "One-click revocation stops listings and generation instantly",
            "2h/3h takedown desk per IT Rules 2026",
          ].map((p) => (
            <p key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> {p}
            </p>
          ))}
        </div>
      </details>

      {/* Roadmap teaser — off-platform protection (Phase 2) */}
      <Card className="mt-6 border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-3">
            <Eye className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Off-platform protection
                <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">Coming soon</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                We&apos;ll monitor the wider web for unauthorized use of your face and file platform
                takedowns for you — using your consent ledger and signed originals as evidence.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Licensed-usage panel (who's using your likeness, on-platform) */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="size-4 text-primary" /> Where your likeness is licensed
          </CardTitle>
          <CardDescription>
            Every brand currently licensed to generate with your replica. Revoke consent above to stop all of it instantly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage && usage.length > 0 ? (
            <ul className="divide-y">
              {usage.map((u) => (
                <li key={u.license_id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{u.buyer_org_name}</span>
                    <span className="text-muted-foreground"> · {u.tier_name}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{inr(u.amount_paise)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${u.status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                      {u.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active brand licenses yet.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
