import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { WelcomeBand } from "@/components/dashboard/welcome-band";
import { pickConsent } from "@/lib/consent-status";
import { StatCard } from "@/components/dashboard/stat-card";
import { CndGenerator } from "@/components/cnd-generator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, ScanFace, FileWarning, ArrowRight } from "lucide-react";


export const metadata = { title: "Protection" };
export const dynamic = "force-dynamic";

// Protection dashboard — the PRIMARY product surface for a celebrity:
// what's watching their likeness, what was caught, and the legal teeth.
export default async function ProtectionPage() {
  const { supabase, profile } = await requireProfile("creator");

  const [{ data: consentRows }, { data: reports }, { count: takedowns }, { data: myListings }] = await Promise.all([
    supabase.from("consent_records")
      .select("id, status, verified_at, authenticity")
      // Several, not one — a newer take being checked must not be reported as
      // the creator's protection status. See lib/consent-status.
      .order("created_at", { ascending: false }).limit(5),
    // my_likeness_reports, not reports: the base table's RLS only exposes rows
    // to the REPORTER or an admin, so a celebrity could never see alerts about
    // their own likeness. The definer view scopes by the creator's org and
    // deliberately withholds the reporter's identity.
    supabase.from("my_likeness_reports")
      .select("id, category, status, detail, sla_deadline, created_at")
      .order("created_at", { ascending: false }).limit(10),
    supabase.from("my_likeness_reports").select("id", { count: "exact", head: true }).eq("status", "actioned"),
    // Needed to know whether the public page exists at all (see below).
    supabase.from("listings").select("status").eq("org_id", profile.org_id),
  ]);

  const { governing: consent } = pickConsent(consentRows);
  const authenticity = consent?.authenticity as { verdict?: string } | null;
  const openReports = (reports ?? []).filter((r) => r.status === "open" || r.status === "reviewing");

  const published = (myListings ?? []).some((l) => l.status === "published");

  return (
    <AppShell role="creator" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name} heading="Protection"
        blurb="Protection first: what's guarding your likeness, what was caught, and the legal teeth.">
        {published && profile.handle ? (
          <Button render={<Link href={`/c/${profile.handle}`} />} nativeButton={false}
            className="bg-white text-emerald-700 hover:bg-emerald-50">
            <ShieldCheck className="size-4" /> View public registry
          </Button>
        ) : (
          <Button render={<Link href="/creator/listing" />} nativeButton={false}
            className="bg-white text-emerald-700 hover:bg-emerald-50">
            <ShieldCheck className="size-4" /> Publish to get your registry page
          </Button>
        )}
      </WelcomeBand>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={ScanFace} label="Consent authenticity" tone="emerald"
          value={authenticity?.verdict === "authentic" ? "Verified human" : consent?.status === "verified" ? "Consent verified" : "Pending"}
          hint="Independent deepfake screening (Reality Defender)" />
        <StatCard icon={ShieldAlert} label="Open alerts" value={String(openReports.length)} tone="amber"
          hint="Reports on the 2h/3h takedown clock" />
        <StatCard icon={FileWarning} label="Takedowns actioned" value={String(takedowns ?? 0)} tone="sky"
          hint="Resolved through the compliance desk" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-primary" /> Recent alerts
            </CardTitle>
            <CardDescription>Every report involving your likeness, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {(reports ?? []).length > 0 ? (
              <ul className="divide-y">
                {(reports ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium capitalize">{r.category.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      r.status === "actioned" ? "bg-emerald-500/15 text-emerald-600"
                      : r.status === "dismissed" ? "bg-muted text-muted-foreground"
                      : "bg-amber-500/15 text-amber-600"}`}>
                      {r.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No alerts. Your registry page tells the world what&apos;s authorised —
                everything else is reportable in one tap.
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Coming in Phase 2: we scan the wider web for your face automatically. For now,
              anyone can report a fake from {published && profile.handle
                ? <Link href={`/c/${profile.handle}`} className="text-primary">your public page</Link>
                : <span>your public page (once your listing is published)</span>} and
              it lands here on the takedown clock.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="size-4 text-primary" /> Cease &amp; desist drafter
            </CardTitle>
            <CardDescription>
              Found a fake? Draft a legal letter grounded in your consent registry, IT Rules 2026
              and Indian personality-rights rulings — ready for your lawyer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CndGenerator />
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        The registry is your anchor:{" "}
        <Link href={published && profile.handle ? `/c/${profile.handle}` : "/creator/listing"} className="inline-flex items-center gap-1 font-medium text-primary">
          your public page <ArrowRight className="size-3.5" />
        </Link>{" "}
        lists every authorised video — anything not on it was never approved.
      </p>
    </AppShell>
  );
}
