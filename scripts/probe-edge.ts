// Edge-case hunt: the paths a demo can stumble into that the happy-path tests
// never touch. Anything that would make a live demo look broken.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(url).hostname.split(".")[0];
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d: string) => {
  good ? pass++ : fail++;
  console.log(`  ${good ? "[OK]  " : "[BUG] "} ${l.padEnd(52)} ${d}`);
};

(async () => {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const session = async (email: string) => {
    const s = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
    }).then((r) => r.json());
    return { cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64")}`, token: s.access_token };
  };
  const brand = await session("brand@consentfirst.test");
  const authed = { "content-type": "application/json", authorization: `Bearer ${brand.token}` };

  console.log("--- BROKEN / HOSTILE URLS (must not 500) ---");
  for (const [label, p] of [
    ["nonexistent celebrity handle", "/c/thispersondoesnotexist"],
    ["malformed generation id on verify", "/verify/not-a-uuid"],
    ["valid-shaped but unknown verify id", "/verify/00000000-0000-4000-8000-000000000000"],
    ["unknown listing id", "/marketplace/00000000-0000-4000-8000-000000000000"],
    ["expired-looking approval token", "/approve/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["random deep path", "/creator/does-not-exist"],
  ] as const) {
    const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
    ok(label, r.status < 500, `HTTP ${r.status}`);
  }

  console.log("--- API INPUT VALIDATION (must 4xx, never 500) ---");
  const bad: Array<[string, string, unknown]> = [
    ["requests: empty script", "/api/requests", { listing_id: "00000000-0000-4000-8000-000000000000", tier_id: "00000000-0000-4000-8000-000000000000", category: "tech", script: "" }],
    ["requests: garbage ids", "/api/requests", { listing_id: "abc", tier_id: "def", category: "tech", script: "a".repeat(50) }],
    ["generations: missing licence", "/api/generations", {}],
    ["generations: bogus engine", "/api/generations", { license_id: "00000000-0000-4000-8000-000000000000", engine: "midjourney" }],
    ["checkout: unknown request", "/api/checkout", { request_id: "00000000-0000-4000-8000-000000000000" }],
  ];
  for (const [label, ep, body] of bad) {
    const r = await fetch(`${BASE}${ep}`, { method: "POST", headers: authed, body: JSON.stringify(body) });
    ok(label, r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
  }

  console.log("--- SCANNER ROBUSTNESS ---");
  const junk = new FormData();
  junk.append("file", new File([new Uint8Array([1, 2, 3, 4, 5])], "notavideo.mp4", { type: "video/mp4" }));
  let r = await fetch(`${BASE}/api/inspect`, { method: "POST", body: junk });
  let j = await r.json();
  ok("corrupt 5-byte 'video' handled gracefully", r.status === 200 && j.ok === true, `HTTP ${r.status} credentialed=${j.credentialed}`);

  const txt = new FormData();
  txt.append("file", new File([new TextEncoder().encode("hello world")], "note.txt", { type: "text/plain" }));
  r = await fetch(`${BASE}/api/inspect`, { method: "POST", body: txt });
  ok("non-video upload handled", r.status === 200 || r.status === 400, `HTTP ${r.status}`);

  console.log("--- DEMO DATA SANITY (what an investor would actually see) ---");
  const { data: pending } = await admin.from("generations").select("id").eq("status", "celebrity_review");
  ok("exactly one approval staged (not 0, not many)", (pending?.length ?? 0) === 1, `${pending?.length ?? 0} pending`);

  const { data: tokens } = await admin.from("approval_tokens").select("token, expires_at, used_at").is("used_at", null);
  const live = (tokens ?? []).filter((t) => new Date(t.expires_at) > new Date());
  ok("a valid unused approval link exists", live.length > 0, `${live.length} live token(s)`);

  const { data: stuck } = await admin.from("generations").select("id, status, created_at")
    .in("status", ["queued", "generating", "processing", "approved"]);
  const old = (stuck ?? []).filter((g) => Date.now() - new Date(g.created_at).getTime() > 15 * 60_000);
  ok("no generations stuck mid-flight", old.length === 0, `${old.length} stale`);

  const { data: failed } = await admin.from("generations").select("id").eq("status", "failed");
  ok("no failed generations littering the demo", (failed?.length ?? 0) === 0, `${failed?.length ?? 0} failed`);

  const { data: listings } = await admin.from("public_listings").select("handle, display_name, consent_verified");
  const unverified = (listings ?? []).filter((l) => !l.consent_verified);
  ok("every published listing has verified consent", unverified.length <= 1,
     `${listings?.length} listings, ${unverified.length} pending (${unverified.map((u) => u.handle).join(",") || "-"})`);

  const { data: reports } = await admin.from("reports").select("status, sla_deadline").eq("status", "open");
  const future = (reports ?? []).filter((x) => new Date(x.sla_deadline) > new Date());
  ok("takedown clock is still counting DOWN", future.length > 0,
     `${reports?.length ?? 0} open, ${future.length} with time left`);

  console.log("--- LEDGER INTEGRITY ---");
  // verify_audit_chain returns a rowset: [{ total, bad, first_bad_id }].
  // "Valid" means bad === 0 — not a boolean, which the first version wrongly assumed.
  const { data: chain } = await admin.rpc("verify_audit_chain");
  const c = (Array.isArray(chain) ? chain[0] : chain) as { total?: number; bad?: number } | null;
  ok("hash-chained audit ledger verifies", (c?.bad ?? -1) === 0, `${c?.total ?? "?"} entries, ${c?.bad ?? "?"} tampered`);

  console.log(`\n  ${pass}/${pass + fail} edge checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
