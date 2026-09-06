// Live-engine rehearsal: runs the REAL brand flow on a deployed environment
// with an explicit engine pick, and waits until the render reaches
// celebrity_review. This is the only test that proves an engine "works" — it
// exercises key, replica, render, download, watermark and preview end to end.
//
// ⚠️ SPENDS REAL PROVIDER CREDIT (that is the point). Not shipped; probe-*
// is excluded from deploys.
//   npx tsx scripts/probe-engine.ts tavus|heygen
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const ENGINE = process.argv[2];
if (ENGINE !== "tavus" && ENGINE !== "heygen") {
  console.error("usage: npx tsx scripts/probe-engine.ts tavus|heygen");
  process.exit(1);
}
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const SCRIPT =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely " +
  "the best I have used. If better sleep is on your list, check them out at aerofit.in.";

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ email: "brand@consentfirst.test", password: process.env.DEMO_PASSWORD }),
  }).then((r) => r.json());
  const authed = { "content-type": "application/json", authorization: `Bearer ${signIn.access_token}` };

  const { data: arjun } = await admin.from("profiles").select("id, org_id").eq("handle", "arjun").single();
  const { data: listing } = await admin.from("listings")
    .select("id").eq("org_id", arjun!.org_id).eq("status", "published").single();
  const { data: tier } = await admin.from("license_tiers")
    .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();

  console.log(`[1/5] submitting script (live policy gate)…`);
  const req = await fetch(`${BASE}/api/requests`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: SCRIPT }),
  }).then((r) => r.json());
  if (req.outcome !== "auto_approved") throw new Error(`gate: ${JSON.stringify(req).slice(0, 200)}`);

  console.log(`[2/5] paying (test mode)…`);
  const co = await fetch(`${BASE}/api/checkout`, {
    method: "POST", headers: authed, body: JSON.stringify({ request_id: req.request_id }),
  }).then((r) => r.json());
  await fetch(`${BASE}/api/payments/mock-confirm`, {
    method: "POST", headers: authed, body: JSON.stringify({ license_id: co.license_id }),
  });

  console.log(`[3/5] generating with engine=${ENGINE}…`);
  const gen = await fetch(`${BASE}/api/generations`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ license_id: co.license_id, engine: ENGINE }),
  }).then((r) => r.json());
  if (!gen.generation_id) throw new Error(`generate: ${JSON.stringify(gen).slice(0, 200)}`);

  console.log(`[4/5] rendering on ${ENGINE} (live — can take a few minutes)…`);
  const cron = { "x-cron-secret": process.env.CRON_SECRET ?? "" };
  const t0 = Date.now();
  let row: { status: string; provider: string; provider_video_id: string | null; preview_path: string | null; error: string | null } | null = null;
  while (Date.now() - t0 < 12 * 60_000) {
    await fetch(`${BASE}/api/jobs/generation-worker`, { method: "POST", headers: cron }).catch(() => {});
    const { data } = await admin.from("generations")
      .select("status, provider, provider_video_id, preview_path, error")
      .eq("id", gen.generation_id).single();
    row = data;
    process.stdout.write(`\r      ${Math.round((Date.now() - t0) / 1000)}s  status=${row!.status}   `);
    if (["celebrity_review", "failed", "blocked"].includes(row!.status)) break;
    await new Promise((r) => setTimeout(r, 6000));
  }
  console.log();
  if (row?.status !== "celebrity_review") {
    throw new Error(`did not reach review: ${row?.status} ${row?.error ?? ""}`);
  }

  console.log(`[5/5] SUCCESS — provider=${row.provider} video=${row.provider_video_id}`);
  const { data: signed } = await admin.storage.from("deliverables").createSignedUrl(row.preview_path!, 900);
  console.log(`preview: ${signed?.signedUrl}`);
  console.log(`generation_id: ${gen.generation_id}`);
})().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
