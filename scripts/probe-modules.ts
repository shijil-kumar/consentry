// Module-by-module functional sweep on the LIVE site: the surfaces the demo
// visits that the engine/gate probes don't touch — registry, scanner, verify,
// protection desk, takedown clocks, fan feed, wallet, notifications.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(url).hostname.split(".")[0];
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d: string) => { good ? pass++ : fail++; console.log(`  ${good ? "[OK]  " : "[FAIL]"} ${l.padEnd(44)} ${d}`); };

async function page(p: string, cookie?: string) {
  const r = await fetch(`${BASE}${p}`, { headers: cookie ? { cookie } : {} });
  const html = await r.text();
  return { status: r.status, txt: html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}

(async () => {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const session = async (email: string) => {
    const s = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
    }).then((r) => r.json());
    return `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64")}`;
  };

  console.log("--- PUBLIC / FAN-FACING ---");
  let r = await page("/c/arjun");
  ok("registry: published rules visible", r.txt.includes("enforced by the gate"), `HTTP ${r.status}`);
  ok("registry: authorised videos listed", /Authorised brand content/i.test(r.txt), "");
  ok("registry: 'not listed = not approved'", /not listed here/i.test(r.txt), "");

  r = await page("/celebrities");
  ok("directory renders protected stars", /THE REGISTRY|Protected/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/marketplace");
  ok("marketplace lists creators", /creators/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/actors");
  ok("actor library shows published take rate", /keep\s*85\s*%/i.test(r.txt) && /platform rate is published/i.test(r.txt), "");
  r = await page("/request-a-star");
  ok("fan voting page renders", r.status === 200, `HTTP ${r.status}`);

  console.log("--- VERIFY / SCANNER ---");
  const { data: g } = await admin.from("generations").select("id, c2pa_manifest").eq("status", "delivered")
    .order("delivered_at", { ascending: false }).limit(1).single();
  r = await page(`/verify/${g!.id}`);
  ok("verify page: credentials embedded+signed", /embedded \+ signed/i.test(r.txt), "");
  ok("verify page: AI label burned in", /burned in/i.test(r.txt), "");
  const v1 = await fetch(`${BASE}/api/v1/verify/${g!.id}`).then((x) => x.json());
  ok("public verify API returns a verdict", v1.verified === true && v1.consent_status === "verified" && v1.provenance_signed === true,
     `verified=${v1.verified} signed=${v1.provenance_signed} labelled=${v1.visibly_labelled}`);

  console.log("--- ROLE DASHBOARDS ---");
  const cookies = {
    creator: await session("arjun@consentfirst.test"),
    brand: await session("brand@consentfirst.test"),
    fan: await session("fan@consentfirst.test"),
    admin: await session("admin@consentfirst.test"),
  };
  r = await page("/creator", cookies.creator);
  ok("creator studio loads", r.status === 200 && /Welcome back/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/creator/protection", cookies.creator);
  ok("protection desk loads", r.status === 200, `HTTP ${r.status}`);
  r = await page("/creator/requests", cookies.creator);
  ok("approvals inbox loads", /approval/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/creator/consent", cookies.creator);
  ok("consent recorder loads", /Record your consent/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/buyer", cookies.brand);
  ok("brand workspace + wallet honesty", /never expire/i.test(r.txt), `HTTP ${r.status}`);
  r = await page("/fan", cookies.fan);
  ok("fan feed loads", r.status === 200, `HTTP ${r.status}`);
  r = await page("/admin", cookies.admin);
  ok("admin: readiness panel says ready", /Ready to demo/i.test(r.txt), "");
  ok("admin: takedown queue present", /takedown/i.test(r.txt), "");

  console.log("--- LIVE DEMO DATA ---");
  const { count: pend } = await admin.from("generations").select("id", { count: "exact", head: true }).eq("status", "celebrity_review");
  ok("an approval is staged and waiting", (pend ?? 0) > 0, `${pend} pending`);
  const { count: esc } = await admin.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "needs_review");
  ok("escalated script queue filled", (esc ?? 0) > 0, `${esc} in manual review`);
  const { data: rep } = await admin.from("reports").select("status, sla_deadline").eq("status", "open");
  ok("takedown desk has a live clock", (rep ?? []).length > 0, `${rep?.length ?? 0} open, deadline ${rep?.[0]?.sla_deadline?.slice(0, 16) ?? "-"}`);
  const { data: pay } = await admin.from("payouts").select("gross_paise, platform_fee_paise, net_paise").limit(3);
  const rateOk = (pay ?? []).every((p) => Math.abs(p.platform_fee_paise / p.gross_paise - 0.15) < 0.001);
  ok("payout math matches published 15%", rateOk && (pay ?? []).length > 0, `${pay?.length ?? 0} payouts checked`);

  console.log(`\n  ${pass}/${pass + fail} module checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
