import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CreditWallet } from "@/components/credit-wallet";
import { WelcomeBand } from "@/components/dashboard/welcome-band";
import { OnboardingSteps } from "@/components/dashboard/onboarding-steps";
import { StatCard } from "@/components/dashboard/stat-card";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, FileVideo2, ArrowRight, BadgeCheck, Megaphone } from "lucide-react";


export const metadata = { title: "Brand workspace" };
export const dynamic = "force-dynamic";
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const reqBadge: Record<string, { label: string; cls: string }> = {
  pending_check: { label: "Checking", cls: "" },
  auto_approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  needs_review: { label: "In review", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  rejected: { label: "Blocked", cls: "bg-red-500/15 text-red-700 border-red-500/30" },
  expired: { label: "Expired", cls: "" },
};

export default async function BuyerDashboard() {
  const { supabase, profile } = await requireProfile("buyer");

  const LIST_LIMIT = 8;
  const [
    { data: requests }, { data: licenses }, { data: wallet },
    { count: requestCount }, { count: activeLicenseCount },
  ] = await Promise.all([
    supabase.from("approval_requests")
      .select("id, status, category, created_at, listing_id, tier_id")
      .eq("buyer_org_id", profile.org_id).order("created_at", { ascending: false }).limit(LIST_LIMIT),
    supabase.from("license_details")
      .select("license_id, status, listing_title, creator_name, expires_at, amount_paise, request_id, consent_status, starts_at")
      .eq("status", "active")
      .order("starts_at", { ascending: false }).limit(LIST_LIMIT),
    supabase.from("credit_wallets").select("balance_paise").maybeSingle(),
    supabase.from("approval_requests")
      .select("id", { count: "exact", head: true }).eq("buyer_org_id", profile.org_id),
    supabase.from("licenses")
      .select("id", { count: "exact", head: true })
      .eq("buyer_org_id", profile.org_id).eq("status", "active"),
  ]);

  const licByRequest = new Map((licenses ?? []).map((l) => [l.request_id, l]));

  return (
    <AppShell role="buyer" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name}
        blurb="License creators, run the script check, and get provenance-sealed videos.">
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href="/buyer/campaign" />} nativeButton={false}
            className="bg-white/15 text-white backdrop-blur hover:bg-white/25">
            <Megaphone className="size-4" /> Campaign Studio
          </Button>
          <Button render={<Link href="/marketplace" />} nativeButton={false}
            className="bg-white text-emerald-700 hover:bg-emerald-50">
            <Store className="size-4" /> Browse creators
          </Button>
        </div>
      </WelcomeBand>

      <OnboardingSteps title="Get your first AI endorsement" steps={[
        { title: "Pick a creator", desc: "Browse the marketplace — every card is consent-verified.",
          done: (requests ?? []).length > 0, href: "/marketplace", cta: "Browse creators" },
        { title: "Submit a script", desc: "It's checked against the creator's rules before you pay.",
          done: (requests ?? []).length > 0, href: "/marketplace", cta: "Write a script" },
        { title: "Top up credits", desc: "Prepay once — approved licenses just debit the wallet.",
          done: (wallet?.balance_paise ?? 0) > 0, href: "/buyer", cta: "Top up below" },
        { title: "License + generate", desc: "Pay, generate, and download your sealed video.",
          done: (activeLicenseCount ?? 0) > 0 || (licenses ?? []).length > 0,
          href: "/buyer", cta: "Finish a request below" },
      ]} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CreditWallet balancePaise={wallet?.balance_paise ?? 0} />
        <StatCard icon={FileVideo2} label="Script requests" value={String(requestCount ?? 0)} tone="sky"
          hint="Every script and where it stands, listed below" />
        <StatCard icon={BadgeCheck} label="Active licenses" value={String(activeLicenseCount ?? 0)} tone="violet"
          hint="Ready to generate right now" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileVideo2 className="size-4 text-primary" /> Your requests
            </CardTitle>
            <CardDescription>Every script and where it stands.</CardDescription>
          </CardHeader>
          <CardContent>
            {requests && requests.length > 0 ? (
              <ul className="space-y-2">
                {requests.map((r) => {
                  const lic = licByRequest.get(r.id);
                  const b = reqBadge[r.status] ?? reqBadge.pending_check;
                  return (
                    <li key={r.id}>
                      <Link href={`/buyer/requests/${r.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{lic?.listing_title ?? r.category}</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {r.category} · {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {lic?.status === "active"
                            ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">Licensed</Badge>
                            : <Badge variant="outline" className={b.cls}>{b.label}</Badge>}
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              ) : (
              <p className="text-sm text-muted-foreground">
                No requests yet. Browse verified creators and submit your first script — it&apos;s
                checked against their rules before you pay a rupee.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4 text-primary" /> Active licenses
            </CardTitle>
            <CardDescription>Assets you can generate and download.</CardDescription>
          </CardHeader>
          <CardContent>
            {licenses && licenses.length > 0 ? (
              <ul className="space-y-2">
                {licenses.map((l) => (
                  <li key={l.license_id}>
                    <Link href={`/buyer/requests/${l.request_id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted">
                      <span>
                        <span className="block font-medium">{l.listing_title}</span>
                        <span className="text-xs text-muted-foreground">
                          {l.creator_name} · {inr(l.amount_paise)}
                          {l.expires_at && ` · expires ${new Date(l.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                          {l.consent_status === "revoked" && " · consent revoked"}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No active licenses yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
