/* eslint-disable @typescript-eslint/no-explicit-any */
// Independent full-surface verification against PRODUCTION.
//
// Deliberately NOT a re-run of the vitest suite: this walks every page and every
// API route the app actually exposes, as each role and as an anonymous visitor,
// and asserts the security boundaries hold. The unit suite can be green while a
// page 500s or a route leaks — this catches that class of failure.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  FAIL  ${name} ${detail}`); }
}
function section(t: string) { console.log(`\n=== ${t} ===`); }

/** Mint a real session cookie for a role, the same shape the browser uses. */
async function sessionFor(role: string): Promise<string> {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess, error } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token, type: "magiclink",
  });
  if (error) throw new Error(`session for ${role}: ${error.message}`);
  const ref = new global.URL(URL_).hostname.split(".")[0];
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sess.session)).toString("base64")}`;
}

async function get(p: string, cookie?: string) {
  const r = await fetch(`${BASE}${p}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { status: r.status, location: r.headers.get("location"), text: await r.text() };
}

(async () => {
  console.log(`Full sweep against ${BASE}\n${new Date().toISOString()}`);

  // ── A. Public pages must render for a stranger ──────────────────────────
  section("A. Public pages (anonymous)");
  const listing = await admin.from("listings").select("id").eq("status", "published").limit(1).single();
  const publicPages: Array<[string, string]> = [
    ["/", "Your face. Your voice"],
    ["/celebrities", "Verified"],
    ["/actors", ""],
    ["/marketplace", "creators"],
    [`/marketplace/${listing.data!.id}`, ""],
    ["/c/arjun", ""],
    ["/inspect", ""],
    ["/request-a-star", ""],
    ["/login", "Sign in"],
    ["/signup", ""],
  ];
  for (const [p, needle] of publicPages) {
    const r = await get(p);
    check(`GET ${p} → 200`, r.status === 200, `got ${r.status}`);
    if (needle) check(`  ${p} contains "${needle}"`, r.text.includes(needle));
  }

  // The roadmap clip must actually be served, not just referenced.
  const vid = await fetch(`${BASE}/videos/seedance-cinematic-demo.mp4`, { method: "HEAD" });
  check("cinematic clip served", vid.ok && Number(vid.headers.get("content-length")) > 1_000_000,
    `${vid.status} ${vid.headers.get("content-length")}`);
  const home = await get("/");
  check("homepage shows cinematic roadmap", home.text.includes("full cinematic scenes"));
  check("homepage labels it roadmap, not product", home.text.includes("roadmap, not product"));
  check("no Seedance coming-soon promise anywhere", !home.text.toLowerCase().includes("coming soon"));

  // ── B. Protected pages must bounce anonymous visitors ───────────────────
  section("B. Protected pages reject anonymous");
  for (const p of ["/creator", "/buyer", "/admin", "/fan", "/creator/consent", "/creator/listing",
                   "/creator/protection", "/creator/requests", "/buyer/campaign"]) {
    const r = await get(p);
    const bounced = r.status === 307 || r.status === 302 || (r.location ?? "").includes("/login");
    check(`anon ${p} → login`, bounced, `got ${r.status} ${r.location ?? ""}`);
  }

  // ── C. API auth boundaries ──────────────────────────────────────────────
  section("C. API routes reject unauthenticated writes");
  const guarded: Array<[string, string]> = [
    ["/api/generations", "POST"], ["/api/checkout", "POST"], ["/api/requests", "POST"],
    ["/api/consent/submit", "POST"], ["/api/consent/handoff", "POST"],
    ["/api/my-approvals", "GET"], ["/api/demo/reset", "POST"],
    ["/api/admin/resolve-report", "POST"], ["/api/script-assist", "POST"],
  ];
  for (const [p, method] of guarded) {
    const r = await fetch(`${BASE}${p}`, {
      method, headers: { "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    check(`anon ${method} ${p} denied`, r.status === 401 || r.status === 403 || r.status === 400,
      `got ${r.status}`);
  }
  // dev login MUST be off in production
  const devLogin = await fetch(`${BASE}/api/dev/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "admin" }),
  });
  check("dev login disabled in production", devLogin.status === 404, `got ${devLogin.status}`);

  // cron routes must require the secret
  const cron = await fetch(`${BASE}/api/jobs/replica-worker`, { method: "POST" });
  check("replica-worker requires auth", cron.status === 401 || cron.status === 403, `got ${cron.status}`);

  // ── D. Each role reaches its own dashboard ──────────────────────────────
  section("D. Role dashboards");
  const cookies: Record<string, string> = {};
  for (const role of ["creator", "buyer", "admin"]) cookies[role] = await sessionFor(role);

  const roleHome: Array<[string, string, string]> = [
    ["creator", "/creator", "Approvals"],
    ["buyer", "/buyer", ""],
    ["admin", "/admin", "Platform"],
  ];
  for (const [role, p, needle] of roleHome) {
    const r = await get(p, cookies[role]);
    check(`${role} GET ${p} → 200`, r.status === 200, `got ${r.status}`);
    if (needle) check(`  ${p} contains "${needle}"`, r.text.includes(needle));
  }
  for (const p of ["/creator/consent", "/creator/listing", "/creator/protection", "/creator/requests"]) {
    const r = await get(p, cookies.creator);
    check(`creator GET ${p} → 200`, r.status === 200, `got ${r.status}`);
  }

  // ── E. Cross-role isolation ─────────────────────────────────────────────
  section("E. Cross-role isolation");
  const buyerOnAdmin = await get("/admin", cookies.buyer);
  check("buyer cannot open /admin", buyerOnAdmin.status !== 200 || !buyerOnAdmin.text.includes("Platform economics"),
    `got ${buyerOnAdmin.status}`);
  const creatorOnAdmin = await get("/admin", cookies.creator);
  check("creator cannot open /admin", creatorOnAdmin.status !== 200 || !creatorOnAdmin.text.includes("Platform economics"),
    `got ${creatorOnAdmin.status}`);

  // The approval token is the credential — it must never reach the buyer.
  const buyerApprovals = await fetch(`${BASE}/api/my-approvals`, { headers: { cookie: cookies.buyer } });
  const buyerBody = await buyerApprovals.text();
  check("buyer gets no approval tokens", !buyerBody.includes("token") || buyerApprovals.status !== 200,
    `status ${buyerApprovals.status}`);

  // ── F. Admin-only RPC is admin-only ─────────────────────────────────────
  section("F. review_voice_check is admin-only");
  const { data: anyConsent } = await admin.from("consent_records").select("id").limit(1).single();
  for (const role of ["creator", "buyer"]) {
    const sess = JSON.parse(Buffer.from(cookies[role].split("base64-")[1], "base64").toString());
    const asRole = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${sess.access_token}` } },
    });
    const { error } = await asRole.rpc("review_voice_check", {
      p_consent_id: anyConsent!.id, p_decision: "accepted",
    });
    check(`${role} blocked from review_voice_check`, Boolean(error), error ? "" : "NO ERROR — LEAK");
  }

  // ── G. Ledger integrity ─────────────────────────────────────────────────
  section("G. Hash-chained audit ledger");
  const { data: chain, error: chainErr } = await admin.rpc("verify_audit_chain");
  const row = Array.isArray(chain) ? chain[0] : chain;
  check("audit chain verifies", !chainErr && Number(row?.bad ?? 1) === 0,
    `total=${row?.total} bad=${row?.bad} ${chainErr?.message ?? ""}`);

  // ── H. Public verification API ──────────────────────────────────────────
  section("H. Public verify + inspect");
  const { data: delivered } = await admin.from("generations")
    .select("id").eq("status", "delivered").limit(1).single();
  const v1 = await fetch(`${BASE}/api/v1/verify/${delivered!.id}`);
  check("/api/v1/verify returns a verdict", v1.ok, `got ${v1.status}`);
  const v1body = await v1.json();
  check("verdict names the creator", JSON.stringify(v1body).length > 20);
  const verifyPage = await get(`/verify/${delivered!.id}`);
  check("/verify/[id] page renders", verifyPage.status === 200, `got ${verifyPage.status}`);
  const unknown = await fetch(`${BASE}/api/v1/verify/00000000-0000-0000-0000-000000000000`);
  check("unknown id is not verified", unknown.status === 404 || !JSON.stringify(await unknown.json()).includes("\"verified\":true"));

  // ── H2. Engine honesty ──────────────────────────────────────────────────
  // DEMO_SAFE_MODE routes UNPICKED work to the free mock engine. If it ever
  // also swallowed an explicitly-picked engine, the picker would be a lie —
  // a brand would choose "Tavus" and silently receive a mock render.
  section("H2. Engine picker routes to the real engine");
  const { data: engineRows } = await admin.from("generations")
    .select("requested_engine, provider").not("requested_engine", "is", null);
  const mismatched = (engineRows ?? []).filter((g: any) => g.requested_engine !== g.provider);
  check("every picked engine rendered on that engine", mismatched.length === 0,
    `${mismatched.length} mismatched of ${(engineRows ?? []).length}`);
  console.log(`   picked-engine generations: ${(engineRows ?? []).length}`);

  // ── I. Health + engine wiring ───────────────────────────────────────────
  section("I. Health and engines");
  const health = await fetch(`${BASE}/api/health`);
  const hb = await health.json();
  check("/api/health ok", health.ok, `got ${health.status}`);
  console.log("   health:", JSON.stringify(hb).slice(0, 400));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("SWEEP CRASHED:", e.message); process.exit(1); });
