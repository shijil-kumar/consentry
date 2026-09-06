/* eslint-disable @typescript-eslint/no-explicit-any */
// Visual + structural check of the surfaces changed in recent sessions:
// creator photos, the desktop approval screen, the admin console detail views,
// and the consent recorder. Captures screenshots at desktop and phone widths and
// asserts the specific things that were reported broken, so a regression shows
// up as a FAIL rather than as something Arjun has to spot in a screenshot.
import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const OUT = "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/uicheck";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let fails = 0;
const ok = (l: string, p: boolean, d = "") => { if (!p) fails++; console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`); };

async function cookieFor(role: string) {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  return { name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64"),
           domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https") };
}

/** Every <img> that is meant to show a person must actually have pixels. */
async function imagesLoaded(p: Page) {
  return p.evaluate(() => [...document.querySelectorAll("img")]
    .filter((i) => !i.src.startsWith("data:"))
    .map((i) => ({ src: i.src.slice(-46), ok: i.complete && i.naturalWidth > 0 })));
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const [creator, adminCk] = await Promise.all([cookieFor("creator"), cookieFor("admin")]);
  const errors: string[] = [];

  for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    console.log(`\n=== ${tag} ${w}x${h} ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addCookies([creator]);
    const p = await ctx.newPage();
    p.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${p.url()} :: ${m.text().slice(0, 120)}`));

    for (const route of ["/c/arjun", "/marketplace", "/creator", "/creator/requests", "/creator/protection"]) {
      await p.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
      await p.waitForTimeout(700);
      const imgs = await imagesLoaded(p);
      const broken = imgs.filter((i) => !i.ok);
      ok(`${route.padEnd(20)} images render`, broken.length === 0,
         broken.length ? broken.map((b) => b.src).join(", ") : `${imgs.length} image(s)`);
      await p.screenshot({ path: `${OUT}/${tag}${route.replace(/\//g, "_")}.png`, fullPage: false });
    }

    // Exactly ONE nav item may be the current page. This regressed once:
    // /creator/protection lit up both "Home" and "Protection".
    for (const route of ["/creator", "/creator/requests", "/creator/protection", "/creator/listing"]) {
      await p.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const cur = await p.evaluate(() =>
        [...document.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent!.trim()));
      const uniq = [...new Set(cur)];
      ok(`${route.padEnd(20)} exactly one nav item is current`, uniq.length === 1, uniq.join(" + ") || "none");
    }

    // No anchor may claim role="button". The Button primitive stamps
    // role="button" on any non-native element, so every
    // `<Button render={<Link/>} nativeButton={false}>` in the app (29 of them)
    // announced itself as a button while actually navigating.
    for (const route of ["/", "/marketplace", "/creator", "/creator/protection", "/consent/phone/expired"]) {
      await p.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const mislabelled = await p.evaluate(() =>
        [...document.querySelectorAll("a[href]")]
          .filter((a) => a.getAttribute("role") === "button")
          .map((a) => (a.textContent ?? "").trim().slice(0, 30)));
      ok(`${route.padEnd(24)} links are not announced as buttons`, mislabelled.length === 0,
         mislabelled.join(", ") || "clean");
    }

    // Creator photo specifically — the thing that was missing before.
    await p.goto(`${BASE}/c/arjun`, { waitUntil: "networkidle" });
    const hasFace = await p.evaluate(() => [...document.querySelectorAll("img")]
      .some((i) => i.naturalWidth > 80 && i.naturalHeight > 80));
    ok("/c/arjun shows a real creator photo", hasFace);

    // Admin console: cards must lead somewhere.
    const actx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await actx.addCookies([adminCk]);
    const ap = await actx.newPage();
    ap.on("console", (m) => m.type() === "error" && errors.push(`${tag} ${ap.url()} :: ${m.text().slice(0, 120)}`));
    await ap.goto(`${BASE}/admin`, { waitUntil: "networkidle", timeout: 60_000 });
    await ap.waitForTimeout(700);
    // The console is ONE page with anchor sections — not /admin/<x> routes. So
    // the thing to assert is that every card link resolves to a section that
    // actually rendered, which is what "I can't get into the details" meant.
    const anchors = await ap.evaluate(() =>
      [...new Set([...document.querySelectorAll("a[href^='#']")]
        .map((a) => (a as HTMLAnchorElement).getAttribute("href")!.slice(1)))]);
    ok("admin cards link to detail sections", anchors.length >= 4, `${anchors.length} section link(s)`);
    for (const id of anchors) {
      const found = await ap.evaluate((x) => {
        const el = document.getElementById(x);
        return el ? (el.closest("[data-slot=card]") ?? el).textContent!.trim().length : 0;
      }, id);
      ok(`admin section #${id}`, found > 100, `${found} chars`);
    }
    await ap.screenshot({ path: `${OUT}/${tag}_admin.png`, fullPage: true });
    await actx.close();
    await ctx.close();
  }
  await browser.close();
  console.log(`\nconsole errors: ${errors.length}`);
  errors.slice(0, 8).forEach((e) => console.log("  " + e));
  ok("no console errors anywhere", errors.length === 0);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nall UI checks passed");
  process.exit(fails ? 1 : 0);
})();
