/* eslint-disable @typescript-eslint/no-explicit-any */
// Capture every screenshot for the demo runbook, straight off PRODUCTION with
// real sessions. Automated so the whole set can be regenerated in one command
// after any UI change — a runbook whose pictures drift from the product is
// worse than no runbook.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const OUT = process.env.SHOTS_DIR ?? "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/shots";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const REF = new URL(URL_).hostname.split(".")[0];

let n = 0;
const manifest: Array<{ file: string; caption: string }> = [];

async function shot(page: Page, name: string, caption: string, full = false) {
  n++;
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
  manifest.push({ file, caption });
  console.log(`  ${file}  ${caption}`);
}

async function sessionValue(role: string) {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess, error } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token, type: "magiclink",
  });
  if (error) throw error;
  return "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64");
}

async function ctxFor(browser: Browser, role: string | null, mobile = false) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  if (role) {
    ctx.addCookies([{
      name: `sb-${REF}-auth-token`, value: await sessionValue(role),
      domain: "consentry.app", path: "/", sameSite: "Lax", secure: true,
    }]);
  }
  return ctx;
}

/** Scroll to a heading and centre it, so section shots are framed properly. */
/** Scroll a named section into view.
 *
 *  This used to search only h1/h2/h3. Every card title in this app renders as a
 *  <div> (CardTitle), so the lookup silently found nothing, the page never
 *  scrolled, and FOUR different admin sections were all captured as the same
 *  top-of-page screenshot — then printed in the PDF under four different
 *  captions. Search any element, and pick the most specific match so a parent
 *  container cannot win.
 */
async function toHeading(page: Page, text: string) {
  const found = await page.evaluate((t) => {
    const hit = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
      .filter((e) => (e.textContent ?? "").includes(t))
      .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length)[0];
    if (!hit) return false;
    hit.scrollIntoView({ block: "center" });
    return true;
  }, text);
  if (!found) throw new Error(`toHeading: nothing on the page contains "${text}" — the shot would be wrong`);
  await page.waitForTimeout(900);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ══ ACT 1 — the public story ═════════════════════════════════════════════
  console.log("\nACT 1 — the public story");
  {
    const ctx = await ctxFor(browser, null);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(p, "home-hero", "Landing page. The promise in one line: your face, your voice, your rules.");
    await toHeading(p, "How it works");
    await shot(p, "home-howitworks", "How it works — four steps: protect, license, approve, prove.");
    await toHeading(p, "full cinematic scenes");
    await shot(p, "home-roadmap-cinematic", "Roadmap section: a real cinematic clip from a consented avatar, labelled honestly as not-yet-purchasable.");
    await p.goto(`${BASE}/celebrities`, { waitUntil: "networkidle" });
    await shot(p, "registry", "The public registry — every protected star, with verified consent badges.");
    await p.goto(`${BASE}/c/arjun`, { waitUntil: "networkidle" });
    await shot(p, "registry-page", "A star's public page: what they have authorised, and their published no-go rules.", true);
    await ctx.close();
  }

  // ══ ACT 2 — the brand buys ═══════════════════════════════════════════════
  console.log("\nACT 2 — the brand");
  const listing = await admin.from("listings").select("id").eq("status", "published").limit(1).single();
  {
    const ctx = await ctxFor(browser, "buyer");
    const p = await ctx.newPage();
    await p.goto(`${BASE}/marketplace`, { waitUntil: "networkidle" });
    await shot(p, "marketplace", "The marketplace a brand sees — real photos, prices, and consent status per creator.");
    await p.goto(`${BASE}/marketplace/${listing.data!.id}`, { waitUntil: "networkidle" });
    await shot(p, "listing-detail", "A listing: pricing tiers and the creator's published rules, before you spend anything.", true);
    await p.goto(`${BASE}/marketplace/${listing.data!.id}/request`, { waitUntil: "networkidle" });
    await shot(p, "script-form", "Submitting a script. The breadcrumb shows exactly where you are and where each link goes.", true);
    await ctx.close();
  }

  // ══ ACT 3 — the star decides ═════════════════════════════════════════════
  console.log("\nACT 3 — the star");
  {
    const ctx = await ctxFor(browser, "creator");
    const p = await ctx.newPage();
    await p.goto(`${BASE}/creator`, { waitUntil: "networkidle" });
    await shot(p, "creator-home", "Creator Studio: consent status, replica status, earnings and pending approvals.", true);
    await p.goto(`${BASE}/creator/requests`, { waitUntil: "networkidle" });
    await shot(p, "creator-approvals", "The approvals inbox — the creator decides, never the platform.", true);
    await p.goto(`${BASE}/creator/listing`, { waitUntil: "networkidle" });
    await shot(p, "creator-rules", "Where the star sets their own rules and prices. These are published publicly.", true);
    await p.goto(`${BASE}/creator/protection`, { waitUntil: "networkidle" });
    await shot(p, "creator-protection", "Protection: revoke consent, and the takedown desk for misuse found in the wild.", true);
    await p.goto(`${BASE}/creator/consent`, { waitUntil: "networkidle" });
    await shot(p, "creator-consent-desktop", "Recording consent on desktop: checklist first, then the option to hand off to your phone.", true);
    await ctx.close();
  }
  {
    const ctx = await ctxFor(browser, "creator", true);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/creator/consent?from=phone`, { waitUntil: "networkidle" });
    await shot(p, "creator-consent-phone", "The same page after scanning the QR on a phone — the recorder comes first, nothing else in the way.");
    await ctx.close();
  }

  // ══ ACT 4 — approval on the phone ════════════════════════════════════════
  console.log("\nACT 4 — approval on the phone");
  // approval_tokens has no created_at — ordering by it silently returned null
  // and cost us the single most important screenshot in the deck.
  const { data: tok, error: tokErr } = await admin.from("approval_tokens")
    .select("token, generation_id").is("used_at", null)
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (tokErr) console.log("  token lookup error:", tokErr.message);
  if (tok) {
    const ctx = await ctxFor(browser, null, true);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/approve/${tok.token}`, { waitUntil: "networkidle" });
    await shot(p, "approve-phone", "THE MOMENT: the star approves on their phone. Watermarked preview only — the clean master stays locked until they say yes.", true);
    await ctx.close();
  } else {
    console.log("  (no pending approval token — run probe-stage first)");
  }

  // ══ ACT 5 — the proof ════════════════════════════════════════════════════
  console.log("\nACT 5 — the proof");
  const { data: delivered } = await admin.from("generations")
    .select("id").eq("status", "delivered").order("created_at", { ascending: false }).limit(1).single();
  {
    const ctx = await ctxFor(browser, null);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/verify/${delivered!.id}`, { waitUntil: "networkidle" });
    await shot(p, "verify-public", "The public proof page anyone can open for a delivered video — no login needed.", true);
    await p.goto(`${BASE}/inspect`, { waitUntil: "networkidle" });
    await shot(p, "inspect-empty", "The scanner: drop in ANY video and ask whether it is real.", true);

    // Wait for the VERDICT, not a fixed timeout — a fixed wait caught the
    // spinner and shipped a runbook page that showed nothing.
    const settled = /Verified|Altered since delivery|no Content Credentials|another issuer/i;
    await p.setInputFiles('input[type=file]', "docs/demo-assets/A-genuine-signed.mp4").catch(() => {});
    await p.waitForFunction((re: string) => new RegExp(re, "i").test(document.body.innerText),
      settled.source, { timeout: 90_000 }).catch(() => {});
    await shot(p, "inspect-genuine", "File A — the genuine delivery. Credentials intact and cross-checked against the live consent ledger.", true);

    // Tampered file
    await p.goto(`${BASE}/inspect`, { waitUntil: "networkidle" });
    await p.setInputFiles('input[type=file]', "docs/demo-assets/B-tampered-4kb-flipped.mp4").catch(() => {});
    await p.waitForFunction((re: string) => new RegExp(re, "i").test(document.body.innerText),
      settled.source, { timeout: 90_000 }).catch(() => {});
    await shot(p, "inspect-tampered", "File B — same video, 4 KB of pixels flipped. The seal catches it. THIS is the demo moment.", true);
    await ctx.close();
  }

  // ══ ACT 6 — the console ══════════════════════════════════════════════════
  console.log("\nACT 6 — the console");
  {
    const ctx = await ctxFor(browser, "admin");
    const p = await ctx.newPage();
    await p.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await shot(p, "admin-top", "Admin console: the readiness check and the one-click demo stager.");
    await toHeading(p, "Voice checks awaiting");
    await shot(p, "admin-voice", "Voice checks awaiting a human — the identity queue, with what we asked for vs what we heard.");
    await toHeading(p, "Platform economics");
    await shot(p, "admin-economics", "Platform economics: your take-rate and the credit-pack ladder.");
    await toHeading(p, "Takedown queue");
    await shot(p, "admin-takedowns", "The takedown desk, on India's IT Rules clock (2h impersonation / 3h other).");
    await toHeading(p, "Ledger");
    await shot(p, "admin-ledger", "The hash-chained ledger — every consent, licence, render and approval, tamper-evident.");
    // Appended last on purpose: shot numbering is positional and the PDF
    // builder addresses files by exact name.
    await toHeading(p, "Video engines");
    await shot(p, "admin-engines", "Video engines. If a Tavus or HeyGen subscription lapses, switch that engine to Replay and the demo still runs end to end — only the render step is substituted.");
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${n} screenshots → ${OUT}`);
  console.log(JSON.stringify(manifest, null, 1));
})().catch((e) => { console.error("SHOTS FAILED:", e.message); process.exit(1); });
