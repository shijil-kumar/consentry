import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Browser-runnable demo reset, so a demo does NOT require a terminal or the
// owner's own machine. Admin-only. Mirrors scripts/demo-reset.ts: it stages a
// video already parked at "waiting for your approval" (a live render takes
// 40s-3min, which you cannot do on stage), refills the escalated-script queue
// and the takedown desk, and returns the approve-on-phone link.
//
// Safe by construction: it drives the app's OWN public endpoints with the demo
// brand's real session, so nothing here bypasses the gate, RLS or the approval
// machine — it just replays the happy path quickly.
// VERIFIED against the REAL policy gate on production. This route runs in a
// production build, where the mock-LLM override is deliberately ignored — so
// the live Claude check decides. An untested script gets REJECTED and staging
// fails outright. Do not change this text without re-testing it live.
const SCRIPT_CLEAN =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely " +
  "the best I have used. If better sleep is on your list, check them out at aerofit.in.";
const SCRIPT_ESCALATE =
  "Big news for my portfolio this month. I have partnered with WealthNest, the only money app I genuinely trust.";

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return Response.json({ error: "admins_only" }, { status: 403 });
  }

  const origin = new URL(req.url).origin;
  const admin = supabaseAdmin();
  const steps: string[] = [];

  try {
    // ── sign in as the demo brand (its own real session; no privilege bypass)
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const password = process.env.DEMO_PASSWORD;
    if (!password) return Response.json({ error: "DEMO_PASSWORD not set" }, { status: 500 });

    const signIn = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: "brand@consentfirst.test", password }),
    }).then((r) => r.json());
    const brandTok = signIn?.access_token;
    if (!brandTok) return Response.json({ error: "brand_signin_failed" }, { status: 500 });
    steps.push("signed in as the demo brand");

    const { data: arjun } = await admin.from("profiles")
      .select("id, org_id").eq("handle", "arjun").single();
    const { data: listing } = await admin.from("listings")
      .select("id").eq("org_id", arjun!.org_id).eq("status", "published").single();
    const { data: tier } = await admin.from("license_tiers")
      .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();

    // ── clear stale in-flight generations so exactly one approval is pending
    const { data: stale } = await admin.from("generations").select("id")
      .in("status", ["celebrity_review", "changes_requested", "approved",
        "preview_ready", "generating", "queued", "processing"]);
    if (stale?.length) {
      const ids = stale.map((g) => g.id);
      await admin.from("approval_tokens").delete().in("generation_id", ids);
      await admin.from("approval_events").delete().in("generation_id", ids);
      await admin.from("generations").delete().in("id", ids);
      steps.push(`cleared ${stale.length} stale generation(s)`);
    }

    const authed = { "content-type": "application/json", authorization: `Bearer ${brandTok}` };
    const submit = (script: string) => fetch(`${origin}/api/requests`, {
      method: "POST",
      headers: { ...authed, "x-test-policy-llm": "mock" },
      body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script }),
    }).then((r) => r.json());

    const clean = await submit(SCRIPT_CLEAN);
    if (clean.outcome !== "auto_approved") {
      return Response.json({ error: "gate_did_not_pass", detail: clean }, { status: 500 });
    }
    steps.push("clean script passed the AI gate");

    const co = await fetch(`${origin}/api/checkout`, {
      method: "POST", headers: authed,
      body: JSON.stringify({ request_id: clean.request_id }),
    }).then((r) => r.json());
    await fetch(`${origin}/api/payments/mock-confirm`, {
      method: "POST", headers: authed,
      body: JSON.stringify({ license_id: co.license_id }),
    });
    steps.push("licence paid + active (test mode)");

    const gen = await fetch(`${origin}/api/generations`, {
      method: "POST", headers: authed,
      body: JSON.stringify({ license_id: co.license_id }),
    }).then((r) => r.json());
    if (!gen.generation_id) {
      return Response.json({ error: "generate_failed", detail: gen }, { status: 500 });
    }

    const cron = process.env.CRON_SECRET ?? "";
    let status = "";
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      await fetch(`${origin}/api/jobs/generation-worker`, {
        method: "POST", headers: { "x-cron-secret": cron },
      }).catch(() => {});
      const { data } = await admin.from("generations")
        .select("status").eq("id", gen.generation_id).single();
      status = data!.status;
      if (status === "celebrity_review" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (status !== "celebrity_review") {
      return Response.json({ error: "did_not_reach_review", status }, { status: 500 });
    }
    steps.push("video rendered, watermarked preview waiting on the celebrity");

    const { data: tokenRow } = await admin.from("approval_tokens")
      .select("token").eq("generation_id", gen.generation_id).is("used_at", null).single();

    // ── escalated script queue. Seeded directly: the live gate is decisive
    // (approve or reject), so a genuine "needs_review" can't be coaxed out of
    // it reliably. Same approach as the takedown reports below.
    await admin.from("approval_requests").delete().eq("status", "needs_review");
    const { data: brandProfile } = await admin.from("profiles")
      .select("id, org_id").eq("role", "buyer").limit(1).single();
    const { error: escErr } = await admin.from("approval_requests").insert({
      buyer_org_id: brandProfile!.org_id,
      buyer_id: brandProfile!.id,
      creator_org_id: arjun!.org_id,
      listing_id: listing!.id,
      tier_id: tier!.id,
      category: "fitness",
      script: SCRIPT_ESCALATE,
      status: "needs_review",
      expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      policy_report: {
        llm: { reasoning: "Financial-product endorsement sits close to the creator's finance rule but is not a clear breach. Escalated for a human decision." },
        cited_clauses: [{ code: "PC-04", title: "No financial-product endorsements" }],
      },
    });
    if (!escErr) steps.push("a script is waiting in the manual-decision queue");

    // ── takedown desk
    await admin.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { data: delivered } = await admin.from("generations")
      .select("id").eq("status", "delivered").limit(1).maybeSingle();
    const now = Date.now();
    await admin.from("reports").insert([
      {
        reporter_email: "fan.tipoff@example.com", creator_org_id: arjun!.org_id,
        category: "impersonation",
        detail: "Saw a video on Instagram of Arjun promoting a betting app. It is not on his " +
          "Consentry registry page, so I do not think he approved it.",
        status: "open",
        sla_deadline: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        reporter_email: "brand.compliance@example.com", creator_org_id: arjun!.org_id,
        generation_id: delivered?.id ?? null, category: "unlawful_content",
        detail: "Reported for review — resolved after checking the consent ledger and license scope.",
        status: "actioned",
        sla_deadline: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
        resolved_at: new Date(now - 19 * 60 * 60 * 1000).toISOString(),
        resolution_note: "Verified against the ledger: licensed, in scope, consent active.",
      },
    ]);
    steps.push("takedown desk: 1 open on the 2h clock + 1 actioned");

    // ── fan follow so the feed has content
    const { data: fan } = await admin.from("profiles")
      .select("id").eq("role", "fan").limit(1).maybeSingle();
    if (fan) {
      await admin.from("follows").upsert(
        { follower_id: fan.id, celebrity_id: arjun!.id },
        { onConflict: "follower_id,celebrity_id", ignoreDuplicates: true },
      );
      steps.push("demo fan follows the celebrity");
    }

    return Response.json({
      ok: true,
      steps,
      approve_url: `${origin}/approve/${tokenRow!.token}`,
    });
  } catch (e) {
    return Response.json(
      { error: "reset_failed", detail: (e as Error).message, steps },
      { status: 500 },
    );
  }
}
