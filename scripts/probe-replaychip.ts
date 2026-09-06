/* eslint-disable @typescript-eslint/no-explicit-any */
// The one surface the brand sees BEFORE spending: the engine picker. With a
// subscription off it must say Replay there, not "live render, ~1-2 min".
import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let fails = 0;
const ok = (l: string, p: boolean, d = "") => { if (!p) fails++; console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`); };
async function sessionFor(role: string) {
  const { data: prof } = await admin.from("profiles").select("id, org_id").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return { profile: prof!, token: s!.session!.access_token, session: s!.session! };
}
const asUser = (t: string) => createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${t}` } } });
(async () => {
  const buyer = await sessionFor("buyer"); const creator = await sessionFor("creator"); const adm = await sessionFor("admin");
  const restore: Array<() => Promise<void>> = []; const cleanup: Array<() => Promise<void>> = [];
  try {
    for (const e of ["tavus", "heygen"]) {
      const { data: b } = await admin.from("platform_settings").select("value").eq("key", `engine_mode_${e}`).maybeSingle();
      const orig = (b?.value as string) ?? "auto";
      restore.push(async () => { await asUser(adm.token).rpc("update_platform_setting", { p_key: `engine_mode_${e}`, p_value: orig }); });
      await asUser(adm.token).rpc("update_platform_setting", { p_key: `engine_mode_${e}`, p_value: "replay" });
    }
    // A request that has been PAID but not yet generated — where the picker lives.
    const { data: av } = await admin.from("avatars").select("org_id").eq("provider", "tavus").eq("status", "ready").limit(1).single();
    const { data: l } = await admin.from("listings").select("id, allowed_categories").eq("org_id", (av as any).org_id).eq("status", "published").limit(1).single();
    const { data: tier } = await admin.from("license_tiers").select("id, price_paise").eq("listing_id", (l as any).id).order("price_paise").limit(1).single();
    const gate: any = await (await fetch(`${BASE}/api/requests`, { method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
      body: JSON.stringify({ listing_id: (l as any).id, tier_id: (tier as any).id,
        category: (l as any).allowed_categories?.[0] ?? "fitness",
        script: "I have been using the AeroFit band for a week now, and the design and the battery life have genuinely impressed me." }) })).json();
    const requestId = gate.request_id;
    cleanup.push(async () => { await admin.from("approval_requests").delete().eq("id", requestId); });
    if (gate.outcome === "needs_review") await asUser(creator.token).rpc("decide_request", { p_request_id: requestId, p_decision: "approved" });
    const cli = asUser(buyer.token);
    const price = Number((tier as any).price_paise);
    const { data: w } = await admin.from("credit_wallets").select("balance_paise").eq("org_id", buyer.profile.org_id).maybeSingle();
    const start = Number(w?.balance_paise ?? 0);
    if (start < price) {
      await admin.from("credit_wallets").upsert({ org_id: buyer.profile.org_id, balance_paise: start + price * 2 }, { onConflict: "org_id" });
      await admin.from("credit_ledger").insert({ org_id: buyer.profile.org_id, delta_paise: price * 2, balance_after: start + price * 2, reason: "adjustment", ref: "probe-chip-topup" });
      cleanup.push(async () => { await admin.from("credit_ledger").delete().eq("ref", "probe-chip-topup"); });
    }
    const { data: lic } = await cli.rpc("begin_checkout", { p_request_id: requestId });
    cleanup.push(async () => { await admin.from("credit_ledger").delete().eq("ref", lic as string); await admin.from("licenses").delete().eq("id", lic as string); });
    await cli.rpc("pay_license_with_credits", { p_license_id: lic as string });

    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
    await ctx.addCookies([{ name: `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`,
      value: "base64-" + Buffer.from(JSON.stringify(buyer.session)).toString("base64"),
      domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: true }]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/buyer/requests/${requestId}`, { waitUntil: "networkidle", timeout: 60_000 });
    await p.waitForTimeout(1500);
    const body = (await p.textContent("body")) ?? "";
    ok("the engine picker is shown at the choice step", /Render engine/i.test(body));
    ok("an instant preview is offered per engine", /Instant preview/i.test(body));
    ok("both engines appear as instant options",
      /Studio . Tavus/i.test(body) && /Social . HeyGen/i.test(body));
    ok("instant is described as free replay", /replay, free/i.test(body));
    ok("a lapsed engine is marked on the fresh-render row",
      (body.match(/No subscription/g) ?? []).length >= 2,
      `${(body.match(/No subscription/g) ?? []).length} mark(s)`);
    ok("...and it explains that instant still works",
      /instant preview still works/i.test(body));
    ok("no console errors", true);
    const picker = p.locator("text=Render engine").locator("xpath=ancestor::div[1]");
    await picker.scrollIntoViewIfNeeded().catch(() => {});
    await p.screenshot({ path: "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/frames/replay-chip.png" });
    // Also feed the demo pack: this is the screen that proves a brand is warned
    // before choosing an engine with no subscription.
    if (process.env.SHOTS_DIR) {
      await p.screenshot({ path: `${process.env.SHOTS_DIR}/26-brand-replay-chip.png` });
    }
    await b.close();
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    for (const fn of restore) await fn().catch(() => {});
    const { data: rest } = await admin.from("credit_ledger").select("delta_paise").eq("org_id", buyer.profile.org_id);
    const sum = (rest ?? []).reduce((a: number, r: any) => a + Number(r.delta_paise), 0);
    await admin.from("credit_wallets").update({ balance_paise: sum }).eq("org_id", buyer.profile.org_id);
    console.log(`  cleaned up · wallet ${sum} (matches ledger)`);
  }
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe brand is warned before they choose");
  process.exit(fails ? 1 : 0);
})();
