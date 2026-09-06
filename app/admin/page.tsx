import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TakedownQueue, type ReportRow } from "@/components/takedown-queue";
import { EconomicsPanel, type Pack } from "@/components/economics-panel";
import { WelcomeBand } from "@/components/dashboard/welcome-band";
import { DemoResetPanel } from "@/components/demo-reset-panel";
import { EngineModePanel } from "@/components/engine-mode-panel";
import { DemoReadinessPanel } from "@/components/demo-readiness-panel";
import { StatCard } from "@/components/dashboard/stat-card";
import { VoiceCheckQueue, type VoiceCheckRow } from "@/components/voice-check-queue";
import { ShieldCheck, ScrollText, ShieldAlert, IndianRupee, Building2, Store, Mic } from "lucide-react";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

// Minimal admin console (screen 13). Admin RLS branches let this role read
// across orgs. Seed an admin via scripts/seed-demo (role set server-side only).
export default async function AdminConsole() {
  const { supabase, profile } = await requireProfile();
  if (profile.role !== "admin") redirect(profile.role === "creator" ? "/creator" : "/buyer");

  const [{ data: review }, { data: audit }, { data: orgs }, { data: listings }, { data: reports }, { data: settings }, { data: voicePending }, { data: members }] = await Promise.all([
    supabase.from("approval_requests")
      .select("id, category, status, created_at, buyer_org_id, creator_org_id")
      .eq("status", "needs_review").order("created_at", { ascending: false }).limit(50),
    supabase.from("audit_log").select("id, action, actor_org_id, created_at")
      .order("id", { ascending: false }).limit(60),
    supabase.from("orgs").select("id, name, type, created_at").order("created_at", { ascending: false }),
    supabase.from("listings").select("id, title, status"),
    supabase.from("reports")
      .select("id, category, detail, status, sla_deadline, created_at, generation_id, reporter_email")
      .order("sla_deadline", { ascending: true }).limit(50).returns<ReportRow[]>(),
    supabase.from("platform_settings").select("key, value"),
    supabase.from("consent_records")
      .select("id, org_id, created_at, voice_captcha")
      .eq("voice_review_state", "pending")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("org_id, role, display_name"),
  ]);
  const setting = new Map((settings ?? []).map((s) => [s.key, s.value]));
  const takeRateBps = Number(setting.get("take_rate_bps") ?? 1500);
  const packs = (setting.get("credit_packs") ?? []) as Pack[];
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const openReports = (reports ?? []).filter((r) => r.status === "open" || r.status === "reviewing").length;

  // The "Organisations" tile used to be a dead number — the only stat with
  // nothing behind it. Every counter on this page should open the thing it
  // counts, so here is the actual list.
  const membersByOrg = new Map<string, Array<{ role: string; display_name: string }>>();
  for (const m of (members ?? []) as Array<{ org_id: string; role: string; display_name: string }>) {
    if (!m.org_id) continue;
    const arr = membersByOrg.get(m.org_id) ?? [];
    arr.push({ role: m.role, display_name: m.display_name });
    membersByOrg.set(m.org_id, arr);
  }


  // Flatten the voice_captcha JSON here rather than in the client component, so
  // the reviewer only ever receives the four fields the decision needs.
  const voiceRows: VoiceCheckRow[] = (voicePending ?? []).map((c) => {
    const vc = (c.voice_captcha ?? {}) as {
      phrase?: string; transcript_excerpt?: string; error?: string;
      match?: { hits?: number; total?: number };
    };
    return {
      id: c.id as string,
      created_at: c.created_at as string,
      org_name: orgName.get(c.org_id as string) ?? "—",
      phrase: vc.phrase ?? null,
      transcript: vc.transcript_excerpt ?? null,
      hits: vc.match?.hits ?? null,
      total: vc.match?.total ?? null,
      error: vc.error ?? null,
    };
  });

  return (
    <AppShell role="admin" displayName={profile.display_name}>
      <WelcomeBand name={profile.display_name}
        blurb="Platform oversight: margins, reviews, takedowns and the ledger across every org." />

      {/* Check first, then stage — in that order on the page, because that is
          the order they must happen in on demo day. */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <DemoReadinessPanel />
        <DemoResetPanel />
      </div>

      {/* Right under the demo controls: if an engine subscription lapses, this
          is what keeps the walkthrough alive. */}
      <div className="mb-6">
        <EngineModePanel
          initial={{
            tavus: (setting.get("engine_mode_tavus") as "auto" | "live" | "replay") ?? "auto",
            heygen: (setting.get("engine_mode_heygen") as "auto" | "live" | "replay") ?? "auto",
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Organisations" value={String(orgs?.length ?? 0)} tone="sky"
          hint="Every creator and brand on the platform" href="#organisations" />
        <StatCard icon={Store} label="Published listings" value={String((listings ?? []).filter((l) => l.status === "published").length)} tone="emerald" href="/marketplace" />
        <StatCard icon={ShieldCheck} label="Pending review" value={String(review?.length ?? 0)} tone="violet"
          hint="Scripts waiting for human judgment" href="#manual-review" />
        <StatCard icon={ShieldAlert} label="Open reports" value={String(openReports)} tone="amber"
          hint="On the 2h/3h takedown clock — see the queue below" href="#takedowns" />
        <StatCard icon={Mic} label="Voice checks" value={String(voiceRows.length)} tone="amber"
          hint="Consent recordings the machine could not confirm" href="#voice-checks" />
      </div>

      <Card className="mt-6" id="voice-checks">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="size-4 text-amber-500" /> Voice checks awaiting a human
          </CardTitle>
          <CardDescription>
            When ElevenLabs Scribe can&apos;t confirm the creator spoke the challenge phrase, the
            recording lands here instead of silently passing. This is an <b>identity</b> question —
            &ldquo;is this really them?&rdquo; — so it is the platform&apos;s call, unlike script
            approval, which is always the creator&apos;s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VoiceCheckQueue rows={voiceRows} />
        </CardContent>
      </Card>


      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IndianRupee className="size-4 text-primary" /> Platform economics
          </CardTitle>
          <CardDescription>Your margins — the take-rate applies to every payout instantly.</CardDescription>
        </CardHeader>
        <CardContent>
          <EconomicsPanel takeRateBps={takeRateBps} packs={packs} />
        </CardContent>
      </Card>

      <Card className="mt-6" id="takedowns">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-amber-500" /> Takedown queue
          </CardTitle>
          <CardDescription>
            Reports triaged against India&apos;s IT Rules 2026 timelines (2h impersonation / 3h other).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TakedownQueue reports={reports ?? []} />
        </CardContent>
      </Card>

      <Card className="mt-6" id="manual-review">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" /> Requests in manual review
          </CardTitle>
          <CardDescription>
            Oversight only — read-only across every creator. <b>The creator decides these</b>,
            from their own Approvals inbox; the platform never overrules a creator on their
            own likeness. That restraint is the product.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {review && review.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead><TableHead>Creator</TableHead>
                  <TableHead>Category</TableHead><TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{orgName.get(r.buyer_org_id) ?? "—"}</TableCell>
                    <TableCell>{orgName.get(r.creator_org_id) ?? "—"}</TableCell>
                    <TableCell className="capitalize">{r.category}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing awaiting review.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6" id="organisations">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-primary" /> Organisations
          </CardTitle>
          <CardDescription>
            Every creator and brand account on the platform, newest first. A creator org
            owns a likeness; a brand org licenses one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Type</TableHead>
                <TableHead>People</TableHead><TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orgs ?? []).slice(0, 60).map((o) => {
                const people = membersByOrg.get(o.id) ?? [];
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{o.type ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {people.length
                        ? people.map((m) => `${m.display_name} (${m.role})`).join(", ")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.created_at
                        ? new Date(o.created_at as string).toLocaleDateString("en-IN",
                            { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(orgs ?? []).length > 60 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing the 60 most recent of {orgs!.length}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-primary" /> Ledger (all orgs)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead><TableHead>Action</TableHead>
                <TableHead>Org</TableHead><TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{a.action}</Badge></TableCell>
                  <TableCell>{a.actor_org_id ? (orgName.get(a.actor_org_id) ?? "—") : "system"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
