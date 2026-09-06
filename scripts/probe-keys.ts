/* eslint-disable @typescript-eslint/no-explicit-any */
// Every API key, actually exercised — not merely "is the variable set".
//
// A key can be present and still be dead: expired, revoked, out of quota, or
// scoped wrong. `present: true` in /api/health only proves someone typed
// something. This calls each provider's cheapest authenticated endpoint and
// reports what the provider itself says, so a lapsed Tavus plan shows up here
// rather than mid-demo.
//
// READ-ONLY: nothing here starts a render or spends generation credit.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

type Verdict = { name: string; wired: boolean; live: boolean | null; detail: string };
const results: Verdict[] = [];

const say = (v: Verdict) => {
  const mark = !v.wired ? "MISSING" : v.live === null ? " ?    " : v.live ? "LIVE  " : "DEAD  ";
  console.log(`  ${mark}  ${v.name.padEnd(24)} ${v.detail}`);
  results.push(v);
};

async function check(
  name: string,
  envVar: string,
  probe: (key: string) => Promise<{ live: boolean; detail: string }>,
) {
  const key = process.env[envVar];
  if (!key) return say({ name, wired: false, live: null, detail: `${envVar} not set` });
  try {
    const { live, detail } = await probe(key);
    say({ name, wired: true, live, detail });
  } catch (e) {
    say({ name, wired: true, live: false, detail: (e as Error).message.slice(0, 90) });
  }
}

const timeout = (ms = 20_000) => AbortSignal.timeout(ms);

(async () => {
  console.log("\n=== VIDEO ENGINES (the two the demo depends on) ===");

  await check("Tavus", "TAVUS_API_KEY", async (key) => {
    // Listing replicas is the cheapest authenticated read Tavus offers.
    const r = await fetch("https://tavusapi.com/v2/replicas?limit=1", {
      headers: { "x-api-key": key }, signal: timeout(),
    });
    const body = await r.text();
    if (r.status === 401 || r.status === 403) return { live: false, detail: `auth rejected (HTTP ${r.status})` };
    if (!r.ok) return { live: false, detail: `HTTP ${r.status}: ${body.slice(0, 70)}` };
    let n = "?";
    try { n = String((JSON.parse(body).data ?? []).length); } catch { /* shape drift is fine */ }
    return { live: true, detail: `authenticated · ${n} replica(s) visible` };
  });

  await check("HeyGen", "HEYGEN_API_KEY", async (key) => {
    const r = await fetch("https://api.heygen.com/v2/avatars", {
      headers: { "x-api-key": key }, signal: timeout(),
    });
    const body = await r.text();
    if (r.status === 401 || r.status === 403) return { live: false, detail: `auth rejected (HTTP ${r.status})` };
    if (!r.ok) return { live: false, detail: `HTTP ${r.status}: ${body.slice(0, 70)}` };
    let n = "?";
    try {
      const j = JSON.parse(body);
      n = String((j.data?.avatars ?? j.data ?? []).length ?? "?");
    } catch { /* shape drift is fine */ }
    return { live: true, detail: `authenticated · ${n} avatar(s) visible` };
  });

  // HeyGen refuses end-user generations unless this is explicitly set, so a
  // valid key alone does NOT mean HeyGen can render for a brand.
  const enduser = process.env.HEYGEN_ALLOW_ENDUSER_GEN === "1";
  say({
    name: "HeyGen end-user gen", wired: enduser, live: enduser ? true : null,
    detail: enduser ? "enabled — HeyGen may render for brands" : "HEYGEN_ALLOW_ENDUSER_GEN is not 1 — HeyGen would refuse and fall back to replay",
  });

  console.log("\n=== CONSENT + POLICY (the parts that gate everything) ===");

  await check("Anthropic (rules gate)", "ANTHROPIC_API_KEY", async (key) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.POLICY_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 4, messages: [{ role: "user", content: "ok" }],
      }),
      signal: timeout(30_000),
    });
    const body = await r.text();
    if (!r.ok) return { live: false, detail: `HTTP ${r.status}: ${body.slice(0, 80)}` };
    return { live: true, detail: `model ${process.env.POLICY_MODEL ?? "default"} responded` };
  });

  await check("ElevenLabs (voice check)", "ELEVENLABS_API_KEY", async (key) => {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key }, signal: timeout(),
    });
    const body = await r.text();
    if (!r.ok) return { live: false, detail: `HTTP ${r.status}: ${body.slice(0, 70)}` };
    try {
      const j = JSON.parse(body);
      const used = j.character_count ?? 0, cap = j.character_limit ?? 0;
      const left = cap - used;
      return {
        live: left > 2000,
        detail: `${left.toLocaleString()} of ${cap.toLocaleString()} characters left` +
          (left <= 2000 ? " — too low for a consent check; Groq fallback carries it" : ""),
      };
    } catch { return { live: true, detail: "authenticated" }; }
  });

  await check("Groq (voice fallback)", "GROQ_API_KEY", async (key) => {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${key}` }, signal: timeout(),
    });
    if (!r.ok) return { live: false, detail: `HTTP ${r.status}` };
    const j: any = await r.json();
    const whisper = (j.data ?? []).some((m: any) => /whisper/i.test(m.id));
    return { live: whisper, detail: whisper ? "authenticated · whisper available" : "authenticated but NO whisper model" };
  });

  await check("Reality Defender", "REALITY_DEFENDER_API_KEY", async (key) => {
    // Presign only — no upload, so no scan is charged.
    //
    // The FILENAME matters: this account is on the free tier, which permits
    // IMAGE scans only and returns 403 for a video extension. That is not a
    // dead key, and it is not a defect — the app deliberately extracts a single
    // frame and submits consent-frame.jpg for exactly this reason. Asking for a
    // .mp4 presign here reported a perfectly healthy key as DEAD three runs
    // running.
    const ask = (fileName: string) => fetch("https://api.prd.realitydefender.xyz/api/files/aws-presigned", {
      method: "POST", headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({ fileName }), signal: timeout(),
    });
    const img = await ask("consent-frame.jpg");
    if (img.status === 401 || img.status === 403) {
      return { live: false, detail: `auth rejected on an image scan (HTTP ${img.status})` };
    }
    if (!img.ok) return { live: false, detail: `HTTP ${img.status}` };
    const vid = await ask("consent-clip.mp4");
    return {
      live: true,
      detail: vid.ok
        ? "authenticated · image and video scans allowed"
        : "authenticated · image scans only (free tier) — the app screens a frame, which is the supported path",
    };
  });

  console.log("\n=== PLATFORM ===");
  for (const [name, v] of [
    ["Supabase URL", "NEXT_PUBLIC_SUPABASE_URL"],
    ["Supabase service key", "SUPABASE_SERVICE_ROLE_KEY"],
    ["Consent challenge secret", "CONSENT_CHALLENGE_SECRET"],
    ["Cron secret", "CRON_SECRET"],
  ] as const) {
    say({ name, wired: Boolean(process.env[v]), live: null, detail: process.env[v] ? "set" : `${v} not set` });
  }

  console.log("\n=== SUMMARY ===");
  const dead = results.filter((r) => r.wired && r.live === false);
  const missing = results.filter((r) => !r.wired);
  if (!dead.length && !missing.length) console.log("  every key is wired and answering");
  for (const d of dead) console.log(`  DEAD:    ${d.name} — ${d.detail}`);
  for (const m of missing) console.log(`  MISSING: ${m.name} — ${m.detail}`);

  // A dead paid engine is not fatal any more — that is what replay is for — so
  // this reports rather than fails, and names the mode that keeps it demoable.
  for (const d of dead) {
    if (/Tavus|HeyGen/.test(d.name)) {
      console.log(`  → switch ${d.name.split(" ")[0].toLowerCase()} to Replay in Admin → Video engines and the demo still runs end to end.`);
    }
  }
})();
