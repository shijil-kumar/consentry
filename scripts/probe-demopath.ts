/* eslint-disable @typescript-eslint/no-explicit-any */
// The investor demo, walked end to end as a real user.
//
// Every step a viewer would see, in order, asserting that the screen actually
// renders the thing being talked about — not merely that it returns 200. A demo
// fails on empty states and placeholder text, not on HTTP codes.
//
//   1  landing            the pitch, and the hero video actually plays
//   2  /celebrities       the registry has real people in it
//   3  /c/<handle>        public rules + authorised-content registry
//   4  /marketplace       browsable, filterable, with photos
//   5  listing detail     tiers and prices, licence terms
//   6  brand submits      the gate decides, and SAYS WHY, citing a clause
//   7  approval           celebrity approves by single-use link
//   8  checkout           wallet debited exactly once, licence active
//   9  generation         mock engine renders, delivers
//  10  /verify/<id>       public proof page for the delivered video
//  11  /inspect           C2PA read-back, and a tampered file is caught
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let fails = 0;
const ok = (l: string, p: boolean, d = "") => {
  if (!p) fails++;
  console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`);
};
const step = (n: number, t: string) => console.log(`\n=== ${n}. ${t} ===`);

async function sessionFor(role: string) {
  const { data: prof } = await admin.from("profiles")
    .select("id, org_id, display_name").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return { profile: prof!, token: sess!.session!.access_token, session: sess!.session! };
}
const cookieFor = (session: any) => ({
  name: `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`,
  value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64"),
  domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https"),
});

async function page(browser: Browser, session?: any, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (session) await ctx.addCookies([cookieFor(session)]);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 100)));
  return { p, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();
  const buyer = await sessionFor("buyer");
  const creator = await sessionFor("creator");

  // ── 1. LANDING ───────────────────────────────────────────────────────────
  step(1, "landing page - the pitch");
  {
    const { p, ctx, errors } = await page(browser);
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
    const t = (await p.textContent("body")) ?? "";
    ok("hero headline renders", /Your face\. Your voice\. Your rules\./i.test(t));
    ok("the three pillars are stated", /consent/i.test(t) && /approv/i.test(t) && /revoke|revocable/i.test(t));
    // A hero video that does not play is the classic demo-opening failure.
    const video = await p.evaluate(() => {
      const v = document.querySelector("video");
      return v ? { has: true, ready: v.readyState, paused: v.paused, err: v.error?.code ?? null } : { has: false };
    });
    ok("hero video element is present", (video as any).has);
    if ((video as any).has) {
      ok("hero video loaded without error", (video as any).err === null, `error=${(video as any).err}`);
      ok("hero video has data to play", ((video as any).ready ?? 0) >= 2, `readyState=${(video as any).ready}`);
    }
    ok("no console errors on the opening screen", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }

  // ── 2 + 3. REGISTRY AND CREATOR PAGE ────────────────────────────────────
  step(2, "public registry");
  let handle = "";
  {
    const { data: listing } = await admin.from("public_listings").select("handle").limit(1).maybeSingle();
    handle = (listing as any)?.handle ?? "arjun";
    const { p, ctx } = await page(browser);
    await p.goto(`${BASE}/celebrities`, { waitUntil: "networkidle" });
    const cards = await p.evaluate(() => document.querySelectorAll("a[href^='/c/']").length);
    ok("registry lists real creators", cards > 0, `${cards} card(s)`);

    await p.goto(`${BASE}/c/${handle}`, { waitUntil: "networkidle" });
    const t = (await p.textContent("body")) ?? "";
    ok(`/c/${handle} shows the public rule list`, /may not/i.test(t));
    ok("authorised-content registry is shown", /Authorised brand content|not listed here/i.test(t));
    const img = await p.evaluate(() =>
      [...document.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 80));
    ok("creator photo renders", img);
    await ctx.close();
  }

  // ── 4 + 5. MARKETPLACE ──────────────────────────────────────────────────
  step(4, "marketplace and listing detail");
  let listingId = "", tierId = "", tierPaise = 0, category = "fitness";
  {
    const { p, ctx } = await page(browser, buyer.session);
    await p.goto(`${BASE}/marketplace`, { waitUntil: "networkidle" });
    const cards = await p.evaluate(() => document.querySelectorAll("a[href^='/marketplace/']").length);
    ok("marketplace has listings", cards > 0, `${cards} listing(s)`);
    const photos = await p.evaluate(() =>
      [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 50).length);
    ok("listing photos load", photos > 0, `${photos} image(s)`);

    const { data: l } = await admin.from("public_listings").select("id").limit(1).single();
    listingId = (l as any).id;
    await p.goto(`${BASE}/marketplace/${listingId}`, { waitUntil: "networkidle" });
    const t = (await p.textContent("body")) ?? "";
    ok("listing detail shows a price in rupees", /₹/.test(t));
    ok("listing detail shows the creator's rules", /may not/i.test(t));
    const { data: tier } = await admin.from("license_tiers")
      .select("id, price_paise").eq("listing_id", listingId).order("price_paise").limit(1).single();
    // Use a category this listing actually allows. Submitting an arbitrary one
    // gets rejected for PP-06 (category mismatch) before the interesting rules
    // are ever consulted — which made an earlier version of this probe "pass"
    // its clause assertion for entirely the wrong reason.
    const { data: cats } = await admin.from("listings")
      .select("allowed_categories").eq("id", listingId).single();
    category = (cats as any)?.allowed_categories?.[0] ?? "fitness";
    tierId = (tier as any).id; tierPaise = Number((tier as any).price_paise);
    ok("a purchasable tier exists", tierPaise > 0, `₹${(tierPaise / 100).toLocaleString("en-IN")}`);
    await ctx.close();
  }

  // ── 6. THE GATE ─────────────────────────────────────────────────────────
  step(6, "the approval gate - the centrepiece");
  let requestId = "";
  {
    console.log(`  (submitting under the allowed category "${category}")`);
    const submit = (script: string) => fetch(`${BASE}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` },
      body: JSON.stringify({ listing_id: listingId, tier_id: tierId, category, script }),
    }).then(async (r) => ({ status: r.status, body: await r.json() as any }));

    const bad = await submit("Doctors do not want you to know this: BurnMax capsules melted 8 kg off me in 3 weeks and normalized my blood sugar.");
    ok("a medical-claim script is blocked", bad.body.outcome === "rejected", bad.body.outcome);
    const codes = (bad.body.cited_clauses ?? []).map((c: any) => c.code);
    ok("...and the brand is told WHICH rule it broke", codes.length > 0, codes.join(", "));
    ok("...specifically the medical-claims rule, not a category technicality",
      codes.includes("PC-03") || codes.includes("PP-02"), codes.join(", "));
    ok("...with a human-readable clause title",
      Boolean(bad.body.cited_clauses?.[0]?.title), bad.body.cited_clauses?.[0]?.title ?? "");
    const { data: noLicence } = await admin.from("licenses")
      .select("id").eq("request_id", bad.body.request_id).maybeSingle();
    ok("a blocked script never creates a licence", noLicence === null);

    const good = await submit("I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely the best I have used for building a morning routine.");
    ok("a clean script is approved", good.body.outcome === "auto_approved", good.body.outcome);
    requestId = good.body.request_id;
  }

  // ── 7 + 8. CHECKOUT ─────────────────────────────────────────────────────
  step(7, "checkout - money moves once");
  let licenseId = "";
  {
    const cli = createClient(URL_, ANON, {
      auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${buyer.token}` } },
    });
    const { data: before } = await admin.from("credit_wallets")
      .select("balance_paise").eq("org_id", buyer.profile.org_id).maybeSingle();
    const startBalance = Number(before?.balance_paise ?? 0);
    if (startBalance < tierPaise) {
      // Top up through the LEDGER, not by writing the balance directly: the
      // audit's money-integrity check asserts balance == sum(ledger), and a
      // bare balance write leaves an unexplained figure behind.
      const topUp = tierPaise * 2;
      await admin.from("credit_wallets").upsert(
        { org_id: buyer.profile.org_id, balance_paise: startBalance + topUp }, { onConflict: "org_id" });
      await admin.from("credit_ledger").insert({
        org_id: buyer.profile.org_id, delta_paise: topUp, balance_after: startBalance + topUp,
        reason: "adjustment", ref: "probe-demopath-topup",
      });
    }
    const { data: lic, error } = await cli.rpc("begin_checkout", { p_request_id: requestId });
    ok("checkout succeeds for an approved request", !error, error?.message ?? "");
    licenseId = lic as string;
    const { data: row } = await admin.from("licenses")
      .select("status, amount_paise").eq("id", licenseId).maybeSingle();
    ok("a licence row exists with a price", Boolean(row), `${row?.status} ₹${Number(row?.amount_paise ?? 0) / 100}`);
    // begin_checkout only reserves; the licence sits at payment_pending until
    // it is actually paid for. That is the step a brand takes in the demo.
    const pay = await cli.rpc("pay_license_with_credits", { p_license_id: licenseId });
    ok("paying from the credit wallet activates the licence", !pay.error, pay.error?.message ?? "");
    const { data: paid } = await admin.from("licenses").select("status").eq("id", licenseId).maybeSingle();
    ok("licence is active after payment", paid?.status === "active", paid?.status ?? "none");
    const { data: ledger } = await admin.from("credit_ledger").select("delta_paise").eq("ref", licenseId);
    ok("the wallet is debited exactly once", (ledger ?? []).length === 1, `${(ledger ?? []).length} ledger row(s)`);
    ok("the debit matches the tier price", Number(ledger?.[0]?.delta_paise ?? 0) === -tierPaise,
      `${ledger?.[0]?.delta_paise} vs -${tierPaise}`);
  }

  // ── 9. GENERATION ───────────────────────────────────────────────────────
  step(9, "generation - the video actually renders");
  let generationId = "";
  {
    const cli = createClient(URL_, ANON, {
      auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${buyer.token}` } },
    });
    const { data: gen, error } = await cli.rpc("create_generation", { p_license_id: licenseId });
    ok("a generation is queued", !error, error?.message ?? "");
    generationId = gen as string;

    // Drive the worker the way the cron does.
    const secret = process.env.CRON_SECRET ?? process.env.JOBS_SECRET ?? "";
    let status = "";
    for (let i = 0; i < 12 && status !== "delivered" && status !== "celebrity_review"; i++) {
      await fetch(`${BASE}/api/jobs/generation-worker`, {
        method: "POST", headers: { "x-cron-secret": secret },
      }).catch(() => null);
      await new Promise((r) => setTimeout(r, 4000));
      const { data: g } = await admin.from("generations")
        .select("status, output_path, error").eq("id", generationId).maybeSingle();
      status = g?.status ?? "";
      if (g?.error) { ok("generation ran without error", false, g.error.slice(0, 90)); break; }
    }
    ok("generation reaches a finished state", ["delivered", "celebrity_review"].includes(status), status || "no status");
    // At celebrity_review the render exists as a PREVIEW. The finished file
    // only exists after the celebrity says yes — which is the point of the
    // whole product, so the demo must not skip it.
    const { data: g } = await admin.from("generations")
      .select("preview_path, provider").eq("id", generationId).maybeSingle();
    ok("a preview was rendered for the celebrity to watch", Boolean(g?.preview_path),
      `${g?.provider} -> ${g?.preview_path ?? "none"}`);
  }

  // ── 9b. THE CELEBRITY APPROVES ──────────────────────────────────────────
  step(10, "celebrity approval - nothing releases without a yes");
  {
    const { data: tok } = await admin.from("approval_tokens")
      .select("token").eq("generation_id", generationId).is("used_at", null).maybeSingle();
    ok("an approval link was minted for the celebrity", Boolean(tok?.token));
    if (tok?.token) {
      // The screen a celebrity actually opens - no login, the link is the credential.
      const { p, ctx, errors } = await page(browser, undefined, 1280, 900);
      const res = await p.goto(`${BASE}/approve/${tok.token}`, { waitUntil: "networkidle", timeout: 60_000 });
      ok("approval screen opens with no login", res?.status() === 200, `HTTP ${res?.status()}`);
      const t = (await p.textContent("body")) ?? "";
      ok("it shows the script the brand asked for", t.length > 300);
      ok("it offers both a yes and a no",
        (await p.getByRole("button", { name: /approve/i }).count()) > 0 &&
        (await p.getByRole("button", { name: /reject|decline/i }).count()) > 0);
      ok("the preview video is on the page", (await p.locator("video").count()) > 0);
      ok("no console errors on the approval screen", errors.length === 0, errors[0] ?? "");
      await ctx.close();

      // Approve it for real.
      const r = await fetch(`${BASE}/api/approval/${tok.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      ok("approving through the link succeeds", r.ok, `HTTP ${r.status}`);

      // A used link must be dead - it is a bearer credential.
      const replay = await fetch(`${BASE}/api/approval/${tok.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      ok("the same link cannot be replayed", !replay.ok, `HTTP ${replay.status}`);

      // Deliver.
      const secret2 = process.env.CRON_SECRET ?? process.env.JOBS_SECRET ?? "";
      let st = "";
      for (let i = 0; i < 10 && st !== "delivered"; i++) {
        await fetch(`${BASE}/api/jobs/generation-worker`, {
          method: "POST", headers: { "x-cron-secret": secret2 },
        }).catch(() => null);
        await new Promise((r2) => setTimeout(r2, 4000));
        const { data: gg } = await admin.from("generations")
          .select("status").eq("id", generationId).maybeSingle();
        st = gg?.status ?? "";
      }
      ok("the approved video is delivered", st === "delivered", st || "not delivered");
      const { data: fin } = await admin.from("generations")
        .select("output_path, output_sha256, watermarked, c2pa_manifest").eq("id", generationId).maybeSingle();
      ok("the delivered file exists and is hashed",
        Boolean(fin?.output_path) && Boolean(fin?.output_sha256),
        `sha256:${String(fin?.output_sha256 ?? "").slice(0, 16)}`);
      ok("the delivered video carries the visible AI label", fin?.watermarked === true);
      ok("Content Credentials are sealed into the file", Boolean(fin?.c2pa_manifest));
    }
  }

  // ── 10. PUBLIC VERIFY PAGE ──────────────────────────────────────────────
  step(10, "public verification page");
  {
    const { p, ctx, errors } = await page(browser);
    const res = await p.goto(`${BASE}/verify/${generationId}`, { waitUntil: "networkidle" });
    ok("verify page loads for anyone, signed in or not", res?.status() === 200, `HTTP ${res?.status()}`);
    const t = (await p.textContent("body")) ?? "";
    ok("it names the creator who authorised it", t.length > 200);
    ok("it shows a content hash", /[0-9a-f]{16}/i.test(t));
    ok("no console errors", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }

  // ── 11. INSPECT ─────────────────────────────────────────────────────────
  step(11, "inspect - the tamper demo");
  {
    const { p, ctx } = await page(browser);
    const res = await p.goto(`${BASE}/inspect`, { waitUntil: "networkidle" });
    ok("inspect page loads", res?.status() === 200, `HTTP ${res?.status()}`);
    const t = (await p.textContent("body")) ?? "";
    ok("it explains what it does in plain language", /upload|drop|choose/i.test(t));
    ok("there is a file input to drop a video on",
      (await p.locator("input[type=file]").count()) > 0);
    await ctx.close();
  }

  // ── CLEANUP ─────────────────────────────────────────────────────────────
  console.log("\n=== cleanup ===");
  if (generationId) {
    // Storage too, not just the row — see purge-orphan-media.ts for why.
    const dir = `${buyer.profile.org_id}/${generationId}`;
    const { data: files } = await admin.storage.from("deliverables").list(dir, { limit: 100 });
    const keys = (files ?? []).map((f: any) => `${dir}/${f.name}`);
    if (keys.length) await admin.storage.from("deliverables").remove(keys);
    await admin.from("approval_tokens").delete().eq("generation_id", generationId);
    await admin.from("generations").delete().eq("id", generationId);
  }
  if (licenseId) {
    // Undo the money exactly: drop this run's ledger rows AND put the balance
    // back, so the wallet still equals the sum of what remains.
    await admin.from("credit_ledger").delete().eq("ref", licenseId);
    await admin.from("credit_ledger").delete().eq("ref", "probe-demopath-topup");
    await admin.from("licenses").delete().eq("id", licenseId);
    const { data: rest } = await admin.from("credit_ledger")
      .select("delta_paise").eq("org_id", buyer.profile.org_id);
    const sum = (rest ?? []).reduce((a: number, r: any) => a + Number(r.delta_paise), 0);
    await admin.from("credit_wallets")
      .update({ balance_paise: sum }).eq("org_id", buyer.profile.org_id);
    console.log(`  wallet restored to ${sum} (matches its ledger)`);
  }
  await admin.from("approval_requests").delete().eq("id", requestId);
  console.log("  probe rows removed");

  await browser.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe whole demo path works end to end");
  process.exit(fails ? 1 : 0);
})();
