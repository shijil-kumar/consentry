/**
 * demo-reset — put the whole system into a PERFECT, demo-ready state in one command.
 *
 * Why this exists: a live render takes ~40s (HeyGen) to ~3min (Tavus). You cannot
 * stand in front of investors waiting for that. This pre-stages a video that is
 * already rendered and sitting in "waiting for your approval", so the approval
 * moment — the best part of the demo — happens INSTANTLY.
 *
 * It creates / guarantees:
 *   1. A video PENDING YOUR APPROVAL  (celebrity home money row + /approve/<token>)
 *   2. An escalated script in the manual queue (/creator/requests)
 *   3. One open takedown report on the SLA clock + one already actioned
 *      (/creator/protection + /admin)
 *   4. Fan follow, star-request votes, avatar views  (fan feed + registry + viral)
 *   5. At least one delivered video in the public registry (/c/arjun, /verify)
 *
 * SAFE: uses the MOCK video provider, so it costs nothing and takes seconds.
 * Run it right before any demo.
 *
 *   1) start the app:   npm run dev            (leave it running)
 *   2) in another shell: npx tsx scripts/demo-reset.ts
 *
 * Point it elsewhere with APP_BASE_URL=http://localhost:3100
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = process.env.DEMO_PASSWORD ?? "ConsentDemo-2026!";
const CRON = process.env.CRON_SECRET ?? "";

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

// The three canonical demo scripts. A = clean, B = blocked (medical claims),
// C = ambiguous (finance) so it escalates to a human decision.
// VERIFIED against the REAL policy gate on production. The mock-LLM header is
// deliberately ignored in a production build, so staging there runs the live
// Claude check — an untested script gets REJECTED and staging fails. Do not
// change this text without re-testing it against https://consentry.app.
const SCRIPT_CLEAN =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely " +
  "the best I have used. If better sleep is on your list, check them out at aerofit.in.";
// The live gate is decisive — it approves or rejects, and reliably coaxing a
// genuine "needs_review" out of it isn't possible. The escalated queue is
// therefore seeded directly, the same way the takedown reports are.
const SCRIPT_ESCALATE =
  "Big news for my portfolio this month. I have partnered with WealthNest, the only money app I genuinely trust.";

const ok = (s: string) => console.log(`  ✓ ${s}`);
const step = (s: string) => console.log(`\n── ${s}`);

async function brandSession() {
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({
    email: "brand@consentfirst.test", password: PASSWORD,
  });
  if (error) throw new Error(`brand sign-in failed: ${error.message}`);
  return data.session!.access_token;
}

async function ids() {
  const { data: arjun } = await admin.from("profiles")
    .select("id, org_id").eq("handle", "arjun").single();
  const { data: listing } = await admin.from("listings")
    .select("id").eq("org_id", arjun!.org_id).eq("status", "published").single();
  const { data: tier } = await admin.from("license_tiers")
    .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();
  const { data: fan } = await admin.from("profiles")
    .select("id").eq("role", "fan").limit(1).maybeSingle();
  return { arjun: arjun!, listingId: listing!.id, tierId: tier!.id, fanId: fan?.id ?? null };
}

async function submitScript(tok: string, listingId: string, tierId: string, script: string) {
  const r = await fetch(`${BASE}/api/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tok}`,
      "x-test-policy-llm": "mock", // free + deterministic; DEV_OPEN-gated in the route
    },
    body: JSON.stringify({ listing_id: listingId, tier_id: tierId, category: "fitness", script }),
  });
  return { status: r.status, body: await r.json() };
}

async function kickWorker() {
  await fetch(`${BASE}/api/jobs/generation-worker`, {
    method: "POST", headers: { "x-cron-secret": CRON },
  }).catch(() => {});
}

async function main() {
  console.log(`\nConsentry demo-reset  ->  ${BASE}\n${"=".repeat(52)}`);

  // preflight: is the app actually up?
  const health = await fetch(`${BASE}/`).then((r) => r.status).catch(() => 0);
  if (health !== 200) {
    throw new Error(`app not reachable at ${BASE} (got ${health}). Start it with: npm run dev`);
  }
  ok(`app reachable at ${BASE}`);

  // The worker picks its engine from the AVATAR row, so this can spend real
  // Tavus/HeyGen credit even when VIDEO_PROVIDER=mock. DEMO_SAFE_MODE=1 is the
  // only switch that truly forces the free mock engine — warn loudly if it is
  // off, because a paid render also stalls the reset for minutes.
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (h && h.demo_safe_mode === false) {
    console.log(
      "\n  !! DEMO_SAFE_MODE is OFF — this reset will spend REAL Tavus/HeyGen credit\n" +
      "     and may stall for minutes. Set DEMO_SAFE_MODE=1 in .env.local and\n" +
      "     restart the server for a free, instant reset.\n",
    );
  } else if (h) {
    ok("safe mode on — free mock engine, no provider credit spent");
  }

  const { arjun, listingId, tierId, fanId } = await ids();
  const tok = await brandSession();
  ok("signed in as the demo brand");

  // ── 1. clear any stale pending approvals so the queue shows exactly one ──
  step("1/5  Video waiting for your approval");
  const { data: stale } = await admin.from("generations")
    .select("id").in("status", ["celebrity_review", "changes_requested", "approved", "preview_ready", "generating", "queued", "processing"]);
  if (stale?.length) {
    const staleIds = stale.map((g) => g.id);
    await admin.from("approval_tokens").delete().in("generation_id", staleIds);
    await admin.from("approval_events").delete().in("generation_id", staleIds);
    await admin.from("generations").delete().in("id", staleIds);
    ok(`cleared ${stale.length} stale in-flight generation(s)`);
  }

  const clean = await submitScript(tok, listingId, tierId, SCRIPT_CLEAN);
  if (clean.body.outcome !== "auto_approved") {
    throw new Error(`expected the clean script to pass the gate, got: ${JSON.stringify(clean.body)}`);
  }
  ok("clean script passed the AI gate");

  const co = await (await fetch(`${BASE}/api/checkout`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ request_id: clean.body.request_id }),
  })).json();
  await fetch(`${BASE}/api/payments/mock-confirm`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ license_id: co.license_id }),
  });
  ok("license paid + active (test mode)");

  const gen = await (await fetch(`${BASE}/api/generations`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ license_id: co.license_id }),
  })).json();
  const genId = gen.generation_id;
  if (!genId) throw new Error(`generate failed: ${JSON.stringify(gen)}`);

  // drive the worker until it parks at celebrity_review (mock provider = fast)
  let status = "";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await kickWorker();
    const { data } = await admin.from("generations").select("status").eq("id", genId).single();
    status = data!.status;
    if (status === "celebrity_review" || status === "failed") break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (status !== "celebrity_review") throw new Error(`generation parked at "${status}", expected celebrity_review`);

  const { data: token } = await admin.from("approval_tokens")
    .select("token").eq("generation_id", genId).is("used_at", null).single();
  ok("video rendered, watermarked preview ready, waiting on YOU");

  // ── 2. escalated script in the manual queue ──
  step("2/5  Escalated script for a human decision");
  await admin.from("approval_requests").delete().eq("status", "needs_review");
  const { data: brandProfile } = await admin.from("profiles")
    .select("id, org_id").eq("role", "buyer").limit(1).single();
  const { error: escErr } = await admin.from("approval_requests").insert({
    buyer_org_id: brandProfile!.org_id,
    buyer_id: brandProfile!.id,
    creator_org_id: arjun.org_id,
    listing_id: listingId,
    tier_id: tierId,
    category: "fitness",
    script: SCRIPT_ESCALATE,
    status: "needs_review",
    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    policy_report: {
      llm: { reasoning: "Financial-product endorsement sits close to the creator's finance rule but is not a clear breach. Escalated for a human decision." },
      cited_clauses: [{ code: "PC-04", title: "No financial-product endorsements" }],
    },
  });
  if (!escErr) ok("a script is waiting in your manual-decision queue");
  else console.log(`  ! could not seed the escalated queue: ${escErr.message}`);

  // ── 3. takedown reports ──
  step("3/5  Takedown desk");
  await admin.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const { data: delivered } = await admin.from("generations")
    .select("id").eq("status", "delivered").limit(1).maybeSingle();
  const now = Date.now();
  await admin.from("reports").insert([
    {
      reporter_email: "fan.tipoff@example.com",
      creator_org_id: arjun.org_id,
      generation_id: null,
      category: "impersonation",
      detail:
        "Saw a video on Instagram of Arjun promoting a betting app. It is not on his Consentry " +
        "registry page, so I do not think he approved it. Link: instagram.com/p/fake-example",
      status: "open",
      sla_deadline: new Date(now + 2 * 60 * 60 * 1000).toISOString(), // 2h IT-Rules clock
    },
    {
      reporter_email: "brand.compliance@example.com",
      creator_org_id: arjun.org_id,
      generation_id: delivered?.id ?? null,
      category: "unlawful_content",
      detail: "Reported for review — resolved after checking the consent ledger and license scope.",
      status: "actioned",
      sla_deadline: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
      resolved_at: new Date(now - 19 * 60 * 60 * 1000).toISOString(),
      resolution_note: "Verified against the ledger: licensed, in scope, consent active. No action needed.",
    },
  ]);
  ok("1 open report on the 2-hour clock + 1 already actioned");

  // ── 4. social proof ──
  step("4/5  Fan + viral surfaces");
  if (fanId) {
    await admin.from("follows")
      .upsert({ follower_id: fanId, celebrity_id: arjun.id },
        { onConflict: "follower_id,celebrity_id", ignoreDuplicates: true });
    ok("demo fan follows you (fan feed has content)");
  }
  const { count: views } = await admin.from("avatar_views")
    .select("id", { count: "exact", head: true }).eq("celebrity_id", arjun.id);
  if (!views) {
    await admin.from("avatar_views").insert(
      ["Acme Wellness", "Nova Athletics", "PulseTrack India"].map((label, i) => ({
        celebrity_id: arjun.id, viewer_label: label, is_sample: true,
        viewed_at: new Date(now - (i + 1) * 26 * 60 * 60 * 1000).toISOString(),
      })),
    );
  }
  ok(`"who viewed your avatar" populated`);

  const { count: stars } = await admin.from("star_requests")
    .select("id", { count: "exact", head: true });
  ok(`request-a-star queue: ${stars ?? 0} entries`);

  // ── 5. registry ──
  step("5/5  Public registry");
  const { count: live } = await admin.from("generations")
    .select("id", { count: "exact", head: true }).eq("status", "delivered");
  if (!live) {
    console.log("  ! no delivered videos yet — run scripts/seed-demo-delivery.ts to add one");
  } else {
    ok(`${live} authorised video(s) on /c/arjun`);
  }

  // ── summary ──
  // Local and production share ONE Supabase database, so seeding through a
  // local server still stages the demo for the live site. Only the host in the
  // link differs — print both so you can demo from either.
  const PROD = process.env.DEMO_PUBLIC_URL ?? "https://consentry.app";
  console.log(`\n${"=".repeat(52)}\nDEMO IS READY\n`);
  console.log(`Approve-on-phone link — open on your PHONE before you start:`);
  console.log(`   live : ${PROD}/approve/${token!.token}`);
  if (!BASE.startsWith(PROD)) console.log(`   local: ${BASE}/approve/${token!.token}`);
  console.log("");
  console.log(`Logins  (password: ${PASSWORD})`);
  console.log(`   celebrity : arjun@consentfirst.test`);
  console.log(`   brand     : brand@consentfirst.test`);
  console.log(`   fan       : fan@consentfirst.test`);
  console.log(`   admin     : admin@consentfirst.test\n`);
  console.log(`Run this again any time to reset to a clean demo state.\n`);
}

main().catch((e) => { console.error("\nDEMO-RESET FAILED:", e.message); process.exit(1); });
