// Rehearsal sweep: signs in as each demo role and fetches every page that role
// will actually open during the demo, reporting the HTTP status and whether the
// content the script promises is really on the page. Catches "renders but empty"
// — a 200 with no data is exactly the failure that reads as broken on stage.
// Not shipped (.vercelignore drops scripts/probe-*).
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];

async function sessionCookie(email: string): Promise<string> {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(s).slice(0, 160)}`);
  // Matches how @supabase/ssr serialises the session into a cookie.
  const value = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64");
  return `sb-${REF}-auth-token=${value}`;
}

const ROLES: Record<string, { email: string; pages: Array<[string, string[]]> }> = {
  creator: {
    email: "arjun@consentfirst.test",
    pages: [
      ["/creator", []],
      ["/creator/protection", ["protection"]],
      ["/creator/requests", []],
      ["/creator/listing", []],
      ["/creator/consent", ["consent"]],
    ],
  },
  brand: {
    email: "brand@consentfirst.test",
    pages: [["/buyer", []], ["/buyer/campaign", []]],
  },
  fan: { email: "fan@consentfirst.test", pages: [["/fan", []]] },
  admin: { email: "admin@consentfirst.test", pages: [["/admin", ["takedown", "Is the demo ready?", "Ready to demo", "Content Credentials seal into the file"]]] },
};

(async () => {
  let bad = 0;
  for (const [role, cfg] of Object.entries(ROLES)) {
    let cookie: string;
    try { cookie = await sessionCookie(cfg.email); }
    catch (e) { console.log(`\n${role.toUpperCase()}  ✗ ${(e as Error).message}`); bad++; continue; }
    console.log(`\n${role.toUpperCase()}  (${cfg.email})`);
    for (const [p, expect] of cfg.pages) {
      const res = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: "manual" });
      const html = res.status === 200 ? await res.text() : "";
      const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
      const missing = expect.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
      const redirected = res.status >= 300 && res.status < 400;
      const ok = res.status === 200 && !missing.length;
      if (!ok) bad++;
      // Print the real headings: a 200 proves the route answered, not that the
      // page has anything on it.
      const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
        .filter(Boolean).slice(0, 3).join(" | ");
      console.log(
        `  ${ok ? "OK  " : "FAIL"} ${res.status} ${p.padEnd(22)}` +
        (redirected ? ` -> ${res.headers.get("location")}` : "") +
        (missing.length ? `  missing: ${missing.join(", ")}` : "") +
        (res.status === 200 ? `  ${(html.length / 1024).toFixed(0)}kb  ${heads}` : ""),
      );
    }
  }
  console.log(bad ? `\n${bad} problem(s).` : "\nall pages OK.");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
