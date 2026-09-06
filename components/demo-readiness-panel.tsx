import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Check, TriangleAlert, X } from "lucide-react";
import { RefreshButton } from "@/components/refresh-button";

// Demo-day pre-flight, IN the product — because the person about to present may
// have nothing but a browser and someone else's laptop. It runs the same checks
// a terminal would and states them in words a non-engineer can act on.
//
// Every row below is a check that has ACTUALLY failed in production while the
// screen looked completely normal. That is the point of the panel: these are the
// failures you cannot catch by clicking around.
//
// Server component on purpose: it reads fresh on every load (the page is
// force-dynamic), and going over HTTP to /api/health rather than importing the
// probe keeps the ~50 MB C2PA native module out of this route's bundle.

interface Health {
  database?: string;
  demo_safe_mode?: boolean;
  env?: Record<string, boolean>;
  media?: {
    label_burn_in?: boolean;
    c2pa_sign_and_read?: boolean;
    c2pa_error?: string;
    label_burn_in_error?: string;
  };
}

interface Row { label: string; ok: boolean; detail: string; critical: boolean }

function rowsFor(h: Health): Row[] {
  const m = h.media ?? {};
  const env = h.env ?? {};
  return [
    {
      label: "Database is awake",
      ok: h.database === "ok",
      critical: true,
      detail: h.database === "ok"
        ? "Reading and writing normally."
        : "The database is not answering. A free project pauses after days of no use — opening it once wakes it back up.",
    },
    {
      label: "Videos get the visible AI label",
      ok: m.label_burn_in === true,
      critical: true,
      detail: m.label_burn_in
        ? "The label is burned into the frames of every preview and every delivery."
        : `Videos would go out with NO label and nothing on screen would tell you. ${m.label_burn_in_error ?? ""}`,
    },
    {
      label: "Content Credentials seal into the file",
      ok: m.c2pa_sign_and_read === true,
      critical: true,
      detail: m.c2pa_sign_and_read
        ? "A file was signed and read back just now — the scanner on /inspect will confirm a real release."
        : `Files would deliver unsigned, and the scanner would fall back to a file-fingerprint match. ${m.c2pa_error ?? ""}`,
    },
    {
      label: "Free video engine (no credits spent)",
      ok: h.demo_safe_mode === true,
      critical: false,
      detail: h.demo_safe_mode
        ? "Staging a demo costs nothing."
        : "A paid render engine is active — staging will spend provider credit and take a few minutes instead of seconds.",
    },
    {
      label: "AI rule-checker connected",
      ok: env.anthropic_api_key === true,
      critical: true,
      detail: env.anthropic_api_key
        ? "The script gate will judge live."
        : "The script gate cannot run, so the blocked-script moment will not work.",
    },
    {
      label: "Deepfake screening connected",
      ok: env.reality_defender_api_key === true,
      critical: false,
      detail: env.reality_defender_api_key
        ? "Consent recordings are screened by the independent detector."
        : "Onboarding will skip the independent human check.",
    },
  ];
}

// Is the STAGED DATA still demoable? The infrastructure can be perfectly healthy
// while the demo itself is spent: the approval link is single-use, so a rehearsal
// consumes it, and the takedown clock is seeded at +2h so it reads "overdue" if
// you stage in the morning and present in the afternoon. Both look fine from the
// outside and both wreck an act. Checked live so the panel can say "press Stage
// again" instead of a misleading "Ready to demo".
async function stagingRows(supabase: SupabaseClient): Promise<Row[]> {
  const [{ count: pending }, { data: reports }] = await Promise.all([
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("status", "celebrity_review"),
    supabase.from("reports").select("sla_deadline").eq("status", "open"),
  ]);
  const ticking = (reports ?? []).some((r) => new Date(r.sla_deadline as string) > new Date());
  return [
    {
      label: "A video is waiting for approval",
      ok: (pending ?? 0) > 0,
      critical: true,
      detail: (pending ?? 0) > 0
        ? `${pending} staged and ready — this is Act 5, the approval moment. Open the link on a phone or right here.`
        : "Nothing is staged. The review link is single-use, so a rehearsal uses it up. Press “Stage the demo”.",
    },
    {
      label: "Takedown clock still counting down",
      ok: ticking,
      critical: false,
      detail: ticking
        ? "The open report has time left on its statutory clock."
        : "The seeded report is past its deadline, so the protection desk will read as overdue instead of ticking. Press “Stage the demo” to reset it.",
    },
  ];
}

export async function DemoReadinessPanel() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = process.env.APP_BASE_URL ?? (host ? `${proto}://${host}` : "");

  let rows: Row[] | null = null;
  try {
    const supabase = await supabaseServer();
    const [res, staging] = await Promise.all([
      fetch(`${base}/api/health`, { cache: "no-store" }),
      stagingRows(supabase),
    ]);
    rows = [...rowsFor(await res.json()), ...staging];
  } catch {
    rows = null;
  }

  const blocking = rows?.filter((r) => !r.ok && r.critical) ?? [];
  const warnings = rows?.filter((r) => !r.ok && !r.critical) ?? [];
  const ready = Boolean(rows) && blocking.length === 0;

  return (
    <Card className={ready ? "border-emerald-500/40 bg-emerald-500/[0.04]" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-primary" /> Is the demo ready?
        </CardTitle>
        <CardDescription>
          Checks the things that break silently — a video can look perfect on screen and still
          have gone out with no AI label. Look here right before you present.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rows ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not run the check. Reload the page to try again.
          </p>
        ) : (
          <>
            <div
              className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                ready
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {ready
                ? warnings.length
                  ? "Ready to demo — with one thing worth knowing below."
                  : "Ready to demo. Everything that matters is working."
                : `Not ready — ${blocking.length} thing${blocking.length > 1 ? "s" : ""} would break on stage.`}
            </div>

            <ul className="mt-4 space-y-2.5">
              {rows.map((r) => (
                <li key={r.label} className="flex items-start gap-2.5">
                  {r.ok ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : r.critical ? (
                    <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <RefreshButton label="Check again" className="mt-4" />
      </CardContent>
    </Card>
  );
}
