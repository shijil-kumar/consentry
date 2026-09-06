/**
 * seed-demo-delivery: drive ONE real end-to-end delivery through the live
 * pipeline (script gate → mock checkout → render → watermarked preview →
 * celebrity approval via the real magic-link token → C2PA-sealed delivery)
 * as the seeded demo brand against Arjun's listing — and DON'T clean up.
 *
 * Result: /c/arjun shows a genuine authorised video, /verify works on it,
 * and the fan feed has content. Everything on the ledger is real.
 *
 * Run with the dev server up:  npx tsx scripts/seed-demo-delivery.ts
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

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

const SCRIPT =
  "Hey everyone! I've been using the PulseTrack fitness band for the last month " +
  "and the sleep tracking honestly surprised me. If you're building a morning " +
  "routine, check them out — link below. This is a paid partnership, and this " +
  "video was made with my AI likeness, with my approval.";

async function main() {
  // brand session (real password sign-in — RLS fully in force)
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({
    email: "brand@consentfirst.test", password: PASSWORD,
  });
  if (sErr) throw sErr;
  const tok = s.session!.access_token;
  const authed = { "content-type": "application/json", authorization: `Bearer ${tok}` };

  // arjun's listing + cheapest tier
  const { data: prof } = await admin.from("profiles").select("id, org_id").eq("handle", "arjun").single();
  const { data: listing } = await admin.from("listings")
    .select("id").eq("org_id", prof!.org_id).eq("status", "published").single();
  const { data: tier } = await admin.from("license_tiers")
    .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();

  // 1) script gate (mock LLM: deterministic + free; DEV_OPEN-gated header)
  const req = await fetch(`${BASE}/api/requests`, {
    method: "POST", headers: { ...authed, "x-test-policy-llm": "mock" },
    body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: SCRIPT }),
  });
  const reqj = await req.json();
  if (reqj.outcome !== "auto_approved") throw new Error(`gate: ${JSON.stringify(reqj)}`);
  console.log("gate ok:", reqj.request_id);

  // 2) mock checkout + confirm
  const co = await (await fetch(`${BASE}/api/checkout`, {
    method: "POST", headers: authed, body: JSON.stringify({ request_id: reqj.request_id }),
  })).json();
  if (!co.license_id) throw new Error(`checkout: ${JSON.stringify(co)}`);
  const conf = await fetch(`${BASE}/api/payments/mock-confirm`, {
    method: "POST", headers: authed, body: JSON.stringify({ license_id: co.license_id }),
  });
  if (conf.status !== 200) throw new Error(`confirm: ${await conf.text()}`);
  console.log("license active:", co.license_id);

  // 3) generate → drive worker to celebrity_review
  const gen = await (await fetch(`${BASE}/api/generations`, {
    method: "POST", headers: authed, body: JSON.stringify({ license_id: co.license_id }),
  })).json();
  if (!gen.generation_id) throw new Error(`generate: ${JSON.stringify(gen)}`);
  const genId = gen.generation_id;

  const drive = async (targets: string[]) => {
    const deadline = Date.now() + 120_000;
    let st = "";
    while (Date.now() < deadline) {
      await fetch(`${BASE}/api/jobs/generation-worker`, {
        method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      });
      const { data } = await admin.from("generations").select("status, error").eq("id", genId).single();
      st = data!.status;
      if (data!.error) console.log("gen error:", data!.error);
      if (targets.includes(st) || st === "failed") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return st;
  };

  const review = await drive(["celebrity_review"]);
  if (review !== "celebrity_review") throw new Error(`expected celebrity_review, got ${review}`);
  console.log("watermarked preview ready, waiting on the celebrity…");

  // 4) approve via the REAL single-use magic-link token
  const { data: t } = await admin.from("approval_tokens")
    .select("token").eq("generation_id", genId).is("used_at", null).single();
  const ap = await fetch(`${BASE}/api/approval/${t!.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve" }),
  });
  if (ap.status !== 200) throw new Error(`approve: ${await ap.text()}`);
  console.log("celebrity approved via magic link");

  // 5) seal + deliver
  const done = await drive(["delivered"]);
  if (done !== "delivered") throw new Error(`expected delivered, got ${done}`);
  console.log(`DELIVERED — generation ${genId} is now on /c/arjun, /verify/${genId} works.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
