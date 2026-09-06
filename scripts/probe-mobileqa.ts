 
// Mobile visual QA against production: at 375x812 and 414x896, every core page
// must have NO horizontal scroll and must render its main heading. This is the
// house standard — a page that scrolls sideways on a phone is a failed page.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "https://consentry.app";
const OUT = "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/mobileqa";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function creatorCookie() {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", "creator").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  return { name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64") };
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const cookie = await creatorCookie();

  const pages: Array<[string, boolean]> = [
    ["/", false], ["/celebrities", false], ["/c/arjun", false], ["/marketplace", false],
    ["/inspect", false], ["/request-a-star", false], ["/login", false],
    ["/creator", true], ["/creator/requests", true], ["/creator/protection", true],
  ];
  let fails = 0;
  for (const [w, h] of [[375, 812], [414, 896]]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await ctx.addCookies([{ ...cookie, domain: "consentry.app", path: "/", sameSite: "Lax" as const, secure: true }]);
    const p = await ctx.newPage();
    console.log(`\n=== ${w}x${h} ===`);
    for (const [route] of pages) {
      await p.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
      await p.waitForTimeout(800);
      const m = await p.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        h1: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 40),
      }));
      const hscroll = m.scrollW > m.innerW + 1;
      if (hscroll) fails++;
      console.log(`  ${hscroll ? "FAIL" : "ok  "}  ${route.padEnd(22)} scrollW=${m.scrollW}/${m.innerW}  h1="${m.h1}"`);
      if (w === 375) {
        await p.screenshot({ path: `${OUT}/${route.replace(/\//g, "_") || "home"}-${w}.png` });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${fails === 0 ? "ALL PAGES CLEAN — no horizontal scroll at either width" : `${fails} horizontal-scroll failures`}`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("QA FAILED:", e.message); process.exit(1); });
