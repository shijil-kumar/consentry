/* eslint-disable @typescript-eslint/no-explicit-any */
// FULL end-to-end walkthrough on production, one engine per run:
//
//   blocked script (gate refuses, nothing charged)
//   → clean script (gate passes)
//   → checkout + payment (test mode)
//   → REAL render on the chosen engine
//   → celebrity approves via their approval token (the human step)
//   → watermark + C2PA seal + delivery
//   → download the master and INSPECT it (must verify against the ledger)
//
// This is the only test that walks the same path a paying brand walks.
// ⚠️ SPENDS REAL PROVIDER CREDIT. probe-* is excluded from deploys.
//   npx tsx scripts/probe-e2e.ts tavus|heygen
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const ENGINE = process.argv[2];
if (ENGINE !== "tavus" && ENGINE !== "heygen") {
  console.error("usage: npx tsx scripts/probe-e2e.ts tavus|heygen");
  process.exit(1);
}
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const OUTDIR = "docs/demo-assets";

const CLEAN_SCRIPT =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely " +
  "the best I have used. If better sleep is on your list, check them out at aerofit.in.";
// Violates Arjun's published no-gambling rule — the gate must refuse it free of charge.
const BLOCKED_SCRIPT =
  "Download the RoyalBet app today and use my code ARJUN for a 5000 rupee free bet. " +
  "Win big every single day — this is the easiest money you will ever make.";

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

  // ── 1. The gate must refuse a rule-breaking script, free of charge ────────
  console.log(`[1/7] submitting a BLOCKED script (gambling — against the published rules)…`);
  const bad = await fetch(`${BASE}/api/requests`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: BLOCKED_SCRIPT }),
  }).then((r) => r.json());
  if (bad.outcome === "auto_approved") throw new Error("GATE FAILURE: gambling script was approved!");
  console.log(`      refused: outcome=${bad.outcome} cited=${(bad.cited_clauses ?? []).map((c: any) => c.code).join(",") || "-"}`);

  // ── 2. Clean script passes ────────────────────────────────────────────────
  console.log(`[2/7] submitting the CLEAN script…`);
  const req = await fetch(`${BASE}/api/requests`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: CLEAN_SCRIPT }),
  }).then((r) => r.json());
  if (req.outcome !== "auto_approved") throw new Error(`gate: ${JSON.stringify(req).slice(0, 300)}`);
  console.log(`      approved: request=${req.request_id}`);

  // ── 3. Pay ────────────────────────────────────────────────────────────────
  console.log(`[3/7] checkout + payment (test mode)…`);
  const co = await fetch(`${BASE}/api/checkout`, {
    method: "POST", headers: authed, body: JSON.stringify({ request_id: req.request_id }),
  }).then((r) => r.json());
  await fetch(`${BASE}/api/payments/mock-confirm`, {
    method: "POST", headers: authed, body: JSON.stringify({ license_id: co.license_id }),
  });

  // ── 4. Render on the REAL engine ──────────────────────────────────────────
  console.log(`[4/7] generating with engine=${ENGINE} (live render — minutes)…`);
  const gen = await fetch(`${BASE}/api/generations`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ license_id: co.license_id, engine: ENGINE }),
  }).then((r) => r.json());
  if (!gen.generation_id) throw new Error(`generate: ${JSON.stringify(gen).slice(0, 300)}`);

  const cron = { "x-cron-secret": process.env.CRON_SECRET ?? "" };
  async function waitFor(statuses: string[], maxMin: number): Promise<any> {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMin * 60_000) {
      await fetch(`${BASE}/api/jobs/generation-worker`, { method: "POST", headers: cron }).catch(() => {});
      const { data } = await admin.from("generations")
        .select("status, provider, provider_video_id, preview_path, output_path, watermarked, c2pa_manifest, error")
        .eq("id", gen.generation_id).single();
      process.stdout.write(`\r      ${Math.round((Date.now() - t0) / 1000)}s  status=${data!.status}     `);
      if (statuses.includes(data!.status) || ["failed", "blocked"].includes(data!.status)) { console.log(); return data; }
      await new Promise((r) => setTimeout(r, 6000));
    }
    console.log();
    throw new Error(`timeout waiting for ${statuses.join("/")}`);
  }

  let row = await waitFor(["celebrity_review"], 12);
  if (row.status !== "celebrity_review") throw new Error(`render failed: ${row.status} ${row.error ?? ""}`);
  console.log(`      rendered on ${row.provider}, preview waiting on the celebrity`);

  // ── 5. The human step: approve via the creator's token ───────────────────
  console.log(`[5/7] approving as the celebrity (their token, their decision)…`);
  const { data: tok } = await admin.from("approval_tokens")
    .select("token").eq("generation_id", gen.generation_id).is("used_at", null).single();
  const appr = await fetch(`${BASE}/api/approval/${tok!.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve" }),
  });
  if (!appr.ok) throw new Error(`approve: HTTP ${appr.status} ${(await appr.text()).slice(0, 200)}`);

  // ── 6. Sealing + delivery ─────────────────────────────────────────────────
  console.log(`[6/7] sealing (watermark + C2PA) and delivering…`);
  row = await waitFor(["delivered"], 8);
  if (row.status !== "delivered") throw new Error(`delivery failed: ${row.status} ${row.error ?? ""}`);
  console.log(`      delivered  watermarked=${row.watermarked}  signed=${row.c2pa_manifest?._signed}`);

  // ── 7. Download the master and make the platform inspect its own work ────
  console.log(`[7/7] downloading the master and inspecting it…`);
  const dl = await admin.storage.from("deliverables").download(row.output_path);
  if (dl.error) throw new Error(`download: ${dl.error.message}`);
  const bytes = Buffer.from(await dl.data.arrayBuffer());
  const outFile = `${OUTDIR}/delivered-${ENGINE}.mp4`;
  writeFileSync(outFile, bytes);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), "check.mp4");
  const ins = await fetch(`${BASE}/api/inspect`, { method: "POST", body: form }).then((r) => r.json());

  console.log(`\n════════ ${ENGINE.toUpperCase()} E2E COMPLETE ════════`);
  console.log(`file          : ${outFile} (${(bytes.length / 1048576).toFixed(1)} MB)`);
  console.log(`inspect       : verdict=${ins.verdict} credentialed=${ins.credentialed}`);
  console.log(`verify page   : ${BASE}/verify/${gen.generation_id}`);
  if (ins.verdict !== "verified") throw new Error("delivered file did not verify!");
})().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
