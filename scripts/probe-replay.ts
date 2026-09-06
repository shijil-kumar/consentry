/* eslint-disable @typescript-eslint/no-explicit-any */
// Engine replay, proved for BOTH paid engines, through the path the demo
// actually takes.
//
// An earlier version of this probe tested whichever engine it happened to find
// first (HeyGen) and drove the worker by hand with the cron secret. Neither
// matches demo day: Arjun may pick Tavus, and on stage nothing holds a cron
// secret — the brand's own page advances the work by polling an org-scoped
// worker every 3 seconds. So this runs BOTH engines and kicks the worker the
// way the browser does, with the buyer's own session.
//
// What must hold, per engine, with the subscription switched off:
//   the rules gate judges · a licence is bought · the wallet is debited once
//   · the render self-advances with no cron · the celebrity gets a single-use
//   link · the AI label is burned in · Content Credentials are sealed · it is
//   hashed and delivered · and every surface says "replay", not "live".
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

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
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return { profile: prof!, token: sess!.session!.access_token, session: sess!.session! };
}
const asUser = (t: string) => createClient(URL_, ANON, {
  auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${t}` } },
});

/** Remove a generation's rendered files. Deleting only the DB row leaves the
 *  preview and master behind forever — 413 MB of orphans had built up that way,
 *  and a project creeping toward its storage ceiling fails uploads mid-demo. */
async function purgeGenerationMedia(generationId: string, buyerOrgId: string) {
  const dir = `${buyerOrgId}/${generationId}`;
  const { data: files } = await admin.storage.from("deliverables").list(dir, { limit: 100 });
  const keys = (files ?? []).map((f: any) => `${dir}/${f.name}`);
  if (keys.length) await admin.storage.from("deliverables").remove(keys);
}


(async () => {
  const buyer = await sessionFor("buyer");
  const creator = await sessionFor("creator");
  const adminActor = await sessionFor("admin");

  // Exactly what the brand's workspace does every 3s while work is mid-flight:
  // an authenticated, org-scoped kick. No cron secret anywhere.
  const kickLikeTheBrowser = () =>
    fetch(`${BASE}/api/jobs/generation-worker`, {
      method: "POST", headers: { authorization: `Bearer ${buyer.token}` },
    }).catch(() => null);

  // Engines that CAN be demoed: ready avatar, verified consent, published listing.
  const { data: avatars } = await admin.from("avatars")
    .select("provider, org_id, status, consent_records!inner(status)")
    .eq("status", "ready").eq("consent_records.status", "verified")
    .in("provider", ["tavus", "heygen"]);
  const targets: Array<{ engine: "tavus" | "heygen"; listingId: string }> = [];
  for (const a of avatars ?? []) {
    const { data: l } = await admin.from("listings")
      .select("id").eq("org_id", (a as any).org_id).eq("status", "published").limit(1).maybeSingle();
    if (l) targets.push({ engine: (a as any).provider, listingId: (l as any).id });
  }
  console.log(`engines to prove: ${targets.map((t) => t.engine).join(", ") || "none"}`);
  ok("both paid engines are demoable", targets.length === 2,
    targets.map((t) => t.engine).join(",") || "none");

  const restore: Array<() => Promise<void>> = [];
  const cleanup: Array<() => Promise<void>> = [];

  try {
    for (const { engine, listingId } of targets) {
      head(`${engine.toUpperCase()} — full demo run with the subscription switched off`);
      const settingKey = `engine_mode_${engine}`;
      const { data: before } = await admin.from("platform_settings")
        .select("value").eq("key", settingKey).maybeSingle();
      const original = (before?.value as string) ?? "auto";
      restore.push(async () => {
        await asUser(adminActor.token).rpc("update_platform_setting", { p_key: settingKey, p_value: original });
      });
      const flip = await asUser(adminActor.token).rpc("update_platform_setting",
        { p_key: settingKey, p_value: "replay" });
      ok("admin switches the engine to replay", flip.error === null, flip.error?.message ?? "");

      // ── the brand's journey ────────────────────────────────────────────
      const { data: tier } = await admin.from("license_tiers")
        .select("id, price_paise").eq("listing_id", listingId).order("price_paise").limit(1).single();
      const { data: cats } = await admin.from("listings")
        .select("allowed_categories").eq("id", listingId).single();
      const category = (cats as any)?.allowed_categories?.[0] ?? "fitness";
      const price = Number((tier as any).price_paise);

      const t0 = Date.now();
      const gateRes = await fetch(`${BASE}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({
          listing_id: listingId, tier_id: (tier as any).id, category,
          script: "I have been using the AeroFit band for a week now, and the design and the battery life have genuinely impressed me.",
        }),
      });
      const gate: any = await gateRes.json();
      ok("the rules gate judges the script", ["auto_approved", "needs_review"].includes(gate.outcome),
        `${gate.outcome} in ${secs(t0)}`);
      const requestId = gate.request_id;
      cleanup.push(async () => { await admin.from("approval_requests").delete().eq("id", requestId); });
      if (gate.outcome === "needs_review") {
        const dec = await asUser(creator.token).rpc("decide_request",
          { p_request_id: requestId, p_decision: "approved" });
        ok("the creator can clear an escalated script", dec.error === null, dec.error?.message ?? "");
      }

      const cli = asUser(buyer.token);
      const { data: w } = await admin.from("credit_wallets")
        .select("balance_paise").eq("org_id", buyer.profile.org_id).maybeSingle();
      const startBalance = Number(w?.balance_paise ?? 0);
      if (startBalance < price) {
        await admin.from("credit_wallets").upsert(
          { org_id: buyer.profile.org_id, balance_paise: startBalance + price * 2 }, { onConflict: "org_id" });
        await admin.from("credit_ledger").insert({
          org_id: buyer.profile.org_id, delta_paise: price * 2, balance_after: startBalance + price * 2,
          reason: "adjustment", ref: `probe-replay-topup-${engine}`,
        });
        cleanup.push(async () => {
          await admin.from("credit_ledger").delete().eq("ref", `probe-replay-topup-${engine}`);
        });
      }
      const { data: lic, error: coErr } = await cli.rpc("begin_checkout", { p_request_id: requestId });
      ok("checkout opens", !coErr, coErr?.message ?? "");
      const licenseId = lic as string;
      cleanup.push(async () => {
        await admin.from("credit_ledger").delete().eq("ref", licenseId);
        await admin.from("licenses").delete().eq("id", licenseId);
      });
      const pay = await cli.rpc("pay_license_with_credits", { p_license_id: licenseId });
      ok("the licence is really paid for", pay.error === null, pay.error?.message ?? "");
      const { data: led } = await admin.from("credit_ledger").select("delta_paise").eq("ref", licenseId);
      ok("the wallet is debited once, at the real price",
        (led ?? []).length === 1 && Number(led![0].delta_paise) === -price,
        `${led?.[0]?.delta_paise} vs -${price}`);

      // Generate through the SAME endpoint the button calls, naming the engine.
      const tGen = Date.now();
      const genRes = await fetch(`${BASE}/api/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
        body: JSON.stringify({ license_id: licenseId, engine }),
      });
      const genBody: any = await genRes.json();
      ok(`the brand can pick ${engine} even with no subscription`, genRes.ok,
        `HTTP ${genRes.status} ${genBody.error ?? ""}`);
      const generationId = genBody.generation_id ?? genBody.id;
      cleanup.push(async () => {
        await purgeGenerationMedia(generationId, buyer.profile.org_id);
        await admin.from("approval_events").delete().eq("generation_id", generationId);
        await admin.from("approval_tokens").delete().eq("generation_id", generationId);
        await admin.from("generations").delete().eq("id", generationId);
      });

      // Advance it the way the open workspace tab does — nothing privileged.
      let status = "";
      for (let i = 0; i < 40 && status !== "celebrity_review"; i++) {
        await kickLikeTheBrowser();
        await sleep(3000);
        const { data: g } = await admin.from("generations")
          .select("status, error").eq("id", generationId).maybeSingle();
        status = g?.status ?? "";
        if (g?.error) { ok("the replay render ran clean", false, g.error.slice(0, 100)); break; }
      }
      ok("it reaches the celebrity WITHOUT any cron — just the open page",
        status === "celebrity_review", `${status} in ${secs(tGen)}`);

      const { data: g1 } = await admin.from("generations")
        .select("render_mode, provider, preview_path").eq("id", generationId).maybeSingle();
      ok("recorded as a replay", g1?.render_mode === "replay", String(g1?.render_mode));
      ok(`still attributed to ${engine}`, g1?.provider === engine, String(g1?.provider));
      ok("a real preview file exists for the celebrity to watch", Boolean(g1?.preview_path));

      // ── the celebrity's moment ─────────────────────────────────────────
      const { data: tok } = await admin.from("approval_tokens")
        .select("token").eq("generation_id", generationId).is("used_at", null).maybeSingle();
      ok("a single-use approval link is minted", Boolean(tok?.token));
      if (!tok?.token) throw new Error(`${engine}: no approval token — cannot continue`);

      const tApp = Date.now();
      const appRes = await fetch(`${BASE}/api/approval/${tok.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      ok("approving works exactly as on a live engine", appRes.ok, `HTTP ${appRes.status}`);

      let st = "";
      for (let i = 0; i < 30 && st !== "delivered"; i++) {
        await kickLikeTheBrowser();
        await sleep(3000);
        const { data: g } = await admin.from("generations").select("status").eq("id", generationId).maybeSingle();
        st = g?.status ?? "";
      }
      ok("the approved video is delivered", st === "delivered", `${st} in ${secs(tApp)}`);

      const { data: fin } = await admin.from("generations")
        .select("output_path, output_sha256, watermarked, c2pa_manifest, render_mode")
        .eq("id", generationId).maybeSingle();
      ok("hashed", Boolean(fin?.output_sha256), `sha256:${String(fin?.output_sha256 ?? "").slice(0, 16)}`);
      ok("visible AI label burned in", fin?.watermarked === true);
      ok("Content Credentials sealed in", Boolean(fin?.c2pa_manifest));
      ok("still says replay after delivery", fin?.render_mode === "replay");
      console.log(`  -> whole run: ${secs(t0)}`);

      // ── what a viewer sees ─────────────────────────────────────────────
      const browser = await chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const errors: string[] = [];
      p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 90)));
      await p.goto(`${BASE}/verify/${generationId}`, { waitUntil: "networkidle", timeout: 60_000 });
      const t = (await p.textContent("body")) ?? "";
      ok("the public page says it was replayed", /replayed sample, not rendered live/i.test(t));
      ok("...and names the engine", new RegExp(engine, "i").test(t));
      ok("no console errors on the proof page", errors.length === 0, errors[0] ?? "");
      await browser.close();
    }

    // ── the brand-facing warning, in a real browser ──────────────────────
    head("the brand sees the Replay chip BEFORE choosing");
    {
      // Put both engines in replay so the picker must show it.
      for (const e of ["tavus", "heygen"]) {
        await asUser(adminActor.token).rpc("update_platform_setting",
          { p_key: `engine_mode_${e}`, p_value: "replay" });
      }
      const browser = await chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await ctx.addCookies([{
        name: `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`,
        value: "base64-" + Buffer.from(JSON.stringify(buyer.session)).toString("base64"),
        domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https"),
      }]);
      const p = await ctx.newPage();
      const { data: req } = await admin.from("approval_requests")
        .select("id").eq("buyer_org_id", buyer.profile.org_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (req) {
        await p.goto(`${BASE}/buyer/requests/${(req as any).id}`, { waitUntil: "networkidle", timeout: 60_000 });
        const body = (await p.textContent("body")) ?? "";
        const picker = /Render engine/i.test(body);
        if (picker) {
          ok("engines with no subscription are chipped Replay", /Replay/i.test(body));
          ok("...and the copy no longer promises a live render",
            /replays this engine/i.test(body));
        } else {
          console.log("  info  this request is past the engine-choice step; picker not shown");
        }
      } else {
        ok("a request exists to inspect the picker on", false, "none found");
      }
      await browser.close();
    }
  } finally {
    head("cleanup");
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    for (const fn of restore) await fn().catch(() => {});
    const { data: rest } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", buyer.profile.org_id);
    const sum = (rest ?? []).reduce((a: number, r: any) => a + Number(r.delta_paise), 0);
    await admin.from("credit_wallets").update({ balance_paise: sum }).eq("org_id", buyer.profile.org_id);
    console.log(`  settings restored · wallet back to ${sum} (matches its ledger)`);
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nboth engines demo cleanly with no subscription, and say so");
  process.exit(fails ? 1 : 0);
})();
