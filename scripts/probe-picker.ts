// UI check for the engine picker: creates a paid-but-not-generated request on
// the deployed site, fetches the buyer workspace page with the brand's real
// session cookie, and asserts the picker options are actually in the HTML.
// Leaves the request un-generated — it becomes a natural demo prop. Not shipped.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const SCRIPT =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely " +
  "the best I have used. If better sleep is on your list, check them out at aerofit.in.";

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const REF = new URL(url).hostname.split(".")[0];
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const s = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email: "brand@consentfirst.test", password: process.env.DEMO_PASSWORD }),
  }).then((r) => r.json());
  const authed = { "content-type": "application/json", authorization: `Bearer ${s.access_token}` };
  const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64")}`;

  const { data: arjun } = await admin.from("profiles").select("org_id").eq("handle", "arjun").single();
  const { data: listing } = await admin.from("listings")
    .select("id").eq("org_id", arjun!.org_id).eq("status", "published").single();
  const { data: tier } = await admin.from("license_tiers")
    .select("id").eq("listing_id", listing!.id).order("sort_order").limit(1).single();

  const req = await fetch(`${BASE}/api/requests`, {
    method: "POST", headers: authed,
    body: JSON.stringify({ listing_id: listing!.id, tier_id: tier!.id, category: "fitness", script: SCRIPT }),
  }).then((r) => r.json());
  if (req.outcome !== "auto_approved") throw new Error(`gate: ${JSON.stringify(req).slice(0, 160)}`);
  const co = await fetch(`${BASE}/api/checkout`, {
    method: "POST", headers: authed, body: JSON.stringify({ request_id: req.request_id }),
  }).then((r) => r.json());
  await fetch(`${BASE}/api/payments/mock-confirm`, {
    method: "POST", headers: authed, body: JSON.stringify({ license_id: co.license_id }),
  });

  const html = await fetch(`${BASE}/buyer/requests/${req.request_id}`, { headers: { cookie } }).then((r) => r.text());
  const expect = ["Render engine", "Instant demo", "Studio · Tavus", "Social · HeyGen", "Seedance 2.0"];
  let bad = 0;
  for (const e of expect) {
    const found = html.includes(e);
    if (!found) bad++;
    console.log(`  ${found ? "OK  " : "MISS"} ${e}`);
  }
  console.log(bad ? `\n${bad} missing.` : `\npicker renders. request: ${BASE}/buyer/requests/${req.request_id}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
