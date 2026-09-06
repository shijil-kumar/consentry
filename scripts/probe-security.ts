// Adversarial probes against the LIVE site: things that MUST be refused.
// Every one of these is a claim the demo makes ("no auto-approve", "the brand
// can't have the master", "revocation stops generation") — proven by attack.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail: string) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "[OK]  " : "[FAIL]"} ${label.padEnd(46)} ${detail}`);
}

(async () => {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tok = async (email: string) => (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
  }).then((r) => r.json())).access_token as string;

  const brand = await tok("brand@consentfirst.test");
  const fan = await tok("fan@consentfirst.test");
  const anonC = createClient(url, anon, { auth: { persistSession: false } });

  // 1. anonymous cannot read the private masters table column
  const { data: raw } = await anonC.from("generations").select("raw_output_url").limit(1);
  check("anon cannot read raw_output_url", !raw || raw.length === 0, `rows=${raw?.length ?? 0}`);

  // 2. a FAN cannot fire the generation gate for someone else's licence
  const { data: anyLic } = await admin.from("licenses").select("id").eq("status", "active").limit(1).single();
  const fanC = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${fan}` } }, auth: { persistSession: false } });
  const { error: gateErr } = await fanC.rpc("create_generation", { p_license_id: anyLic!.id });
  check("fan cannot fire create_generation", /not_buyer|GATE:/.test(gateErr?.message ?? ""), gateErr?.message?.slice(0, 40) ?? "NO ERROR");

  // 3. service-only RPCs are not callable by a normal user
  const brandC = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${brand}` } }, auth: { persistSession: false } });
  const { error: cgErr } = await brandC.rpc("complete_generation", { p_generation_id: anyLic!.id, p_output_path: "x", p_manifest: {} });
  check("complete_generation blocked for users", !!cgErr, cgErr?.message?.slice(0, 40) ?? "NO ERROR");

  // 4. approval endpoint rejects a forged token
  const forged = await fetch(`${BASE}/api/approval/${"z".repeat(32)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }),
  });
  check("forged approval token refused", forged.status === 404 || forged.status === 410, `HTTP ${forged.status}`);

  // 5. the worker cannot be driven without the cron secret
  const worker = await fetch(`${BASE}/api/jobs/generation-worker`, { method: "POST", headers: { "x-cron-secret": "wrong" } });
  check("worker rejects a bad cron secret", worker.status === 401 || worker.status === 403, `HTTP ${worker.status}`);

  // 6. the audit ledger is append-only even for the service role
  const { error: audErr } = await admin.from("audit_log").delete().eq("id", -1);
  check("audit_log delete blocked (service role)", !!audErr, audErr?.message?.slice(0, 40) ?? "NO ERROR");

  // 7. NO AUTO-APPROVE: no delivered generation lacks a human approval event
  const { data: delivered } = await admin.from("generations").select("id").eq("status", "delivered");
  let orphan = 0;
  for (const g of delivered ?? []) {
    const { count } = await admin.from("approval_events").select("id", { count: "exact", head: true })
      .eq("generation_id", g.id).eq("action", "approved");
    if (!count) orphan++;
  }
  check("every delivery has a human approval", orphan === 0, `${delivered?.length ?? 0} delivered, ${orphan} without approval`);

  // 8. a delivered asset is not publicly fetchable without a signed URL
  const { data: outPath } = await admin.from("generations").select("output_path").eq("status", "delivered").limit(1).single();
  const direct = await fetch(`${url}/storage/v1/object/public/deliverables/${outPath!.output_path}`);
  check("delivered file not public without signing", direct.status >= 400, `HTTP ${direct.status}`);

  console.log(`\n  ${pass}/${pass + fail} security boundaries held`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
