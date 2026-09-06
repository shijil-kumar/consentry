/* eslint-disable @typescript-eslint/no-explicit-any */
// Prove BOTH paid engines render for real — and capture what they produce.
//
// This SPENDS provider credit: one render per engine. That is the point. The
// Tavus subscription is ending, so the last honest moment to confirm the live
// path works is while it still does. Each successful render is also saved as
// that engine's replay master, so when the plan lapses the fallback shows what
// the engine produced TODAY rather than a months-old clip.
//
// Run: npx tsx scripts/probe-live-engines.ts            (both engines)
//      npx tsx scripts/probe-live-engines.ts tavus      (just one)
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let fails = 0;
const ok = (l: string, p: boolean, d = "") => {
  if (!p) fails++;
  console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`);
};
const head = (t: string) => console.log(`\n=== ${t} ===`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(0)}s`;

async function sessionFor(role: string) {
  const { data: prof } = await admin.from("profiles")
    .select("id, org_id, display_name").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return { profile: prof!, token: s!.session!.access_token };
}
const asUser = (t: string) => createClient(URL_, ANON, {
  auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${t}` } },
});

(async () => {
  const only = process.argv[2];
  const buyer = await sessionFor("buyer");
  const creator = await sessionFor("creator");
  const adminActor = await sessionFor("admin");

  const kick = () => fetch(`${BASE}/api/jobs/generation-worker`, {
    method: "POST", headers: { authorization: `Bearer ${buyer.token}` },
  }).catch(() => null);

  const { data: avatars } = await admin.from("avatars")
    .select("provider, org_id, status, consent_records!inner(status)")
    .eq("status", "ready").eq("consent_records.status", "verified")
    .in("provider", ["tavus", "heygen"]);
  const targets: Array<{ engine: "tavus" | "heygen"; listingId: string }> = [];
  for (const a of avatars ?? []) {
    const { data: l } = await admin.from("listings")
      .select("id").eq("org_id", (a as any).org_id).eq("status", "published").limit(1).maybeSingle();
    if (l && (!only || only === (a as any).provider)) {
      targets.push({ engine: (a as any).provider, listingId: (l as any).id });
    }
  }
  console.log(`live renders to attempt: ${targets.map((t) => t.engine).join(", ")}`);
  console.log("this spends provider credit — one render per engine\n");

  const restore: Array<() => Promise<void>> = [];
  const cleanup: Array<() => Promise<void>> = [];

  try {
    for (const { engine, listingId } of targets) {
      head(`${engine.toUpperCase()} — LIVE render (real provider API)`);
      const key = `engine_mode_${engine}`;
      const { data: before } = await admin.from("platform_settings")
        .select("value").eq("key", key).maybeSingle();
      const original = (before?.value as string) ?? "auto";
      restore.push(async () => {
        await asUser(adminActor.token).rpc("update_platform_setting", { p_key: key, p_value: original });
      });
      // Force live so a healthy key cannot silently fall through to replay and
      // let this probe "pass" without ever touching the provider.
      await asUser(adminActor.token).rpc("update_platform_setting", { p_key: key, p_value: "live" });

      const { data: tier } = await admin.from("license_tiers")
        .select("id, price_paise").eq("listing_id", listingId).order("price_paise").limit(1).single();
      const { data: cats } = await admin.from("listings")
        .select("allowed_categories").eq("id", listingId).single();
      const price = Number((tier as any).price_paise);

      const t0 = Date.now();
      const gate: any = await (await fetch(`${BASE}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({
          listing_id: listingId, tier_id: (tier as any).id,
          category: (cats as any)?.allowed_categories?.[0] ?? "fitness",
          script: "I have been using the AeroFit band for a week now, and the design and the battery life have genuinely impressed me.",
        }),
      })).json();
      ok("rules gate judged the script", ["auto_approved", "needs_review"].includes(gate.outcome), gate.outcome);
      const requestId = gate.request_id;
      cleanup.push(async () => { await admin.from("approval_requests").delete().eq("id", requestId); });
      if (gate.outcome === "needs_review") {
        await asUser(creator.token).rpc("decide_request", { p_request_id: requestId, p_decision: "approved" });
      }

      const cli = asUser(buyer.token);
      const { data: w } = await admin.from("credit_wallets")
        .select("balance_paise").eq("org_id", buyer.profile.org_id).maybeSingle();
      const start = Number(w?.balance_paise ?? 0);
      if (start < price) {
        await admin.from("credit_wallets").upsert(
          { org_id: buyer.profile.org_id, balance_paise: start + price * 2 }, { onConflict: "org_id" });
        await admin.from("credit_ledger").insert({
          org_id: buyer.profile.org_id, delta_paise: price * 2, balance_after: start + price * 2,
          reason: "adjustment", ref: `probe-live-topup-${engine}`,
        });
        cleanup.push(async () => { await admin.from("credit_ledger").delete().eq("ref", `probe-live-topup-${engine}`); });
      }
      const { data: lic } = await cli.rpc("begin_checkout", { p_request_id: requestId });
      const licenseId = lic as string;
      cleanup.push(async () => {
        await admin.from("credit_ledger").delete().eq("ref", licenseId);
        await admin.from("licenses").delete().eq("id", licenseId);
      });
      await cli.rpc("pay_license_with_credits", { p_license_id: licenseId });

      const genRes = await fetch(`${BASE}/api/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({ license_id: licenseId, engine }),
      });
      const genBody: any = await genRes.json();
      ok(`${engine} accepted the generation`, genRes.ok, `HTTP ${genRes.status} ${genBody.error ?? ""}`);
      const generationId = genBody.generation_id ?? genBody.id;
      if (!generationId) { ok(`${engine} returned a generation id`, false); continue; }
      cleanup.push(async () => {
        const dir = `${buyer.profile.org_id}/${generationId}`;
        const { data: files } = await admin.storage.from("deliverables").list(dir, { limit: 100 });
        const keys = (files ?? []).map((f: any) => `${dir}/${f.name}`);
        if (keys.length) await admin.storage.from("deliverables").remove(keys);
        await admin.from("approval_events").delete().eq("generation_id", generationId);
        await admin.from("approval_tokens").delete().eq("generation_id", generationId);
        await admin.from("generations").delete().eq("id", generationId);
      });

      // A real render takes minutes, not seconds. Be patient and say so.
      let status = "", lastNote = "";
      for (let i = 0; i < 120 && status !== "celebrity_review"; i++) {
        await kick();
        await sleep(5000);
        const { data: g } = await admin.from("generations")
          .select("status, error, provider_video_id").eq("id", generationId).maybeSingle();
        status = g?.status ?? "";
        if (g?.error) { ok(`${engine} rendered without error`, false, g.error.slice(0, 120)); break; }
        const note = `${status}${g?.provider_video_id ? ` (${g.provider_video_id.slice(0, 22)})` : ""}`;
        if (note !== lastNote) { console.log(`        ${secs(t0).padStart(5)}  ${note}`); lastNote = note; }
        if (status === "failed") break;
      }
      ok(`${engine} produced a preview from the REAL API`, status === "celebrity_review",
        `${status} after ${secs(t0)}`);
      if (status !== "celebrity_review") continue;

      const { data: g1 } = await admin.from("generations")
        .select("render_mode, provider, raw_output_url").eq("id", generationId).maybeSingle();
      ok("recorded as a LIVE render, not a replay", g1?.render_mode === "live", String(g1?.render_mode));
      ok(`attributed to ${engine}`, g1?.provider === engine, String(g1?.provider));

      // Approve + deliver.
      const { data: tok } = await admin.from("approval_tokens")
        .select("token").eq("generation_id", generationId).is("used_at", null).maybeSingle();
      if (!tok?.token) { ok("approval link minted", false); continue; }
      await fetch(`${BASE}/api/approval/${tok.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      let st = "";
      for (let i = 0; i < 40 && st !== "delivered"; i++) {
        await kick();
        await sleep(4000);
        const { data: g } = await admin.from("generations").select("status").eq("id", generationId).maybeSingle();
        st = g?.status ?? "";
      }
      ok(`${engine} delivered`, st === "delivered", `${st} in ${secs(t0)} total`);

      const { data: fin } = await admin.from("generations")
        .select("output_path, output_sha256, watermarked, c2pa_manifest, raw_output_url")
        .eq("id", generationId).maybeSingle();
      ok("hashed, labelled and sealed",
        Boolean(fin?.output_sha256) && fin?.watermarked === true && Boolean(fin?.c2pa_manifest));

      // ── refresh the replay master from THIS render ────────────────────
      // Prefer the provider's raw output: it has no burnt-in label yet, so the
      // pipeline can apply exactly one when replaying it later. Fall back to
      // the delivered file (whose label re-applies in the same spot, verified).
      let masterBytes: Buffer | null = null;
      let masterFrom = "";
      if (fin?.raw_output_url && /^https?:/.test(fin.raw_output_url)) {
        const r = await fetch(fin.raw_output_url, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
        if (r?.ok) { masterBytes = Buffer.from(await r.arrayBuffer()); masterFrom = "provider raw output"; }
      }
      if (!masterBytes && fin?.output_path) {
        const { data: dl } = await admin.storage.from("deliverables").download(fin.output_path);
        if (dl) { masterBytes = Buffer.from(await dl.arrayBuffer()); masterFrom = "delivered master"; }
      }
      if (masterBytes && masterBytes.byteLength > 100_000) {
        await writeFile(`assets/replay-${engine}.mp4`, masterBytes);
        ok(`replay master for ${engine} refreshed from today's render`, true,
          `${(masterBytes.byteLength / 1e6).toFixed(1)} MB from the ${masterFrom}`);
      } else {
        ok(`replay master for ${engine} refreshed`, false, "could not fetch this render");
      }
    }
  } finally {
    head("cleanup");
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    for (const fn of restore) await fn().catch(() => {});
    const { data: rest } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", buyer.profile.org_id);
    const sum = (rest ?? []).reduce((a: number, r: any) => a + Number(r.delta_paise), 0);
    await admin.from("credit_wallets").update({ balance_paise: sum }).eq("org_id", buyer.profile.org_id);
    console.log(`  engine modes restored · wallet ${sum} (matches ledger)`);
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nboth engines render live, and their replay masters are current");
  process.exit(fails ? 1 : 0);
})();
