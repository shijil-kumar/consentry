/* eslint-disable @typescript-eslint/no-explicit-any */
// Phone QA for the consent recorder. Checks the three reported defects:
//   1. Portrait 9:16 must actually produce a portrait frame (not a cropped 16:9).
//   2. The record button must be reachable without scrolling past the preview.
//   3. HeyGen-style aids (framing guide, legible teleprompter) must be present.
// A fake camera device is supplied so getUserMedia resolves headlessly.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const OUT = "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/recorder";
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

let fails = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const cookie = await creatorCookie();

  const VIEWPORTS: Array<[number, number, string]> = [
    [320, 568, "iPhone SE (smallest still in use)"],
    [360, 740, "common Android"],
    [390, 844, "iPhone 14/15"],
    [430, 932, "iPhone Pro Max"],
    [740, 360, "phone held sideways"],
    [768, 1024, "tablet portrait"],
  ];
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      permissions: ["camera", "microphone"],
    });
    await ctx.addCookies([{ ...cookie, domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https") }]);
    const p = await ctx.newPage();

    console.log(`\n=== ${w}x${h} ===`);
    await p.goto(`${BASE}/creator/consent`, { waitUntil: "networkidle", timeout: 60_000 });
    await p.waitForTimeout(1200);
    // The dev-only role switcher (NEXT_PUBLIC_DEV_OPEN=1, absent in production)
    // is also fixed to the bottom and would swallow the tap. Drop it so the
    // probe measures production stacking, not a dev affordance.
    const dropDevBar = () =>
      p.evaluate(() => document.querySelector('div.fixed.bottom-3[class*="z-["]')?.remove());
    await dropDevBar();

    // Choose portrait, then start the camera.
    const portrait = p.getByText(/Portrait/i).first();
    if (await portrait.count()) await portrait.click();
    const start = p.getByRole("button", { name: /Start camera/i }).first();
    ok("Start camera is visible", await start.isVisible().catch(() => false));
    await start.click({ timeout: 10_000 }).catch((e) => console.log("    click failed:", e.message));
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/preview-portrait-${w}.png` });

    // 1. The frame must be portrait, not landscape.
    const box = await p.locator("video").first().boundingBox();
    ok("preview frame is portrait (h > w)", Boolean(box && box.height > box.width),
       box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no video box");

    // Measure against what the PAGE sees. Under Playwright's mobile emulation
    // window.innerHeight can differ from the configured viewport (590 vs 568 on
    // the 320-wide profile), and a fixed bar is pinned to the former. Comparing
    // to the latter reported a correctly-pinned bar as 2px overflowing.
    const vh = await p.evaluate(() => window.innerHeight);

    // 2. The record button must be on screen without scrolling.
    const rec = p.getByRole("button", { name: /Start recording/i }).first();
    const rbox = await rec.boundingBox().catch(() => null);
    ok("record button within the viewport", Boolean(rbox && rbox.y >= 0 && rbox.y + rbox.height <= vh + 1),
       rbox ? `y=${Math.round(rbox.y)}..${Math.round(rbox.y + rbox.height)} of ${vh}` : "not found");
    ok("record button is a comfortable tap target (>=44px)", Boolean(rbox && rbox.height >= 44),
       rbox ? `${Math.round(rbox.height)}px tall` : "");

    // 3. HeyGen-style framing guide while lining up.
    ok("face-framing guide is shown", (await p.getByText(/Line your face up/i).count()) > 0);

    // 3b. ...and it must not be tucked under the sticky header, which is what
    //     `scroll-mt` exists to prevent.
    const capBox = await p.getByText(/Line your face up/i).first().boundingBox();
    const headerBottom = await p.evaluate(() => {
      const h = document.querySelector("header");
      return h ? Math.round(h.getBoundingClientRect().bottom) : 0;
    });
    ok("framing guide is not hidden behind the header",
       Boolean(capBox && capBox.y >= headerBottom - 1),
       capBox ? `caption y=${Math.round(capBox.y)} vs header bottom ${headerBottom}` : "not found");

    // 4. The mic check must be on screen BEFORE recording — a dead mic
    //    otherwise costs the creator a full 65-second take.
    ok("mic check is shown before recording", (await p.getByText(/Mic check/i).count()) > 0);
    const meterBox = await p.getByText(/Mic check/i).first().boundingBox();
    ok("mic check is above the fold", Boolean(meterBox && meterBox.y >= 0 && meterBox.y < vh),
       meterBox ? `y=${Math.round(meterBox.y)} of ${vh}` : "not found");

    // 5. Screen-lock guidance: the still half is silent, so an auto-locking
    //    phone kills the take.
    ok("screen-lock guidance is present", (await p.getByText(/auto-lock/i).count()) > 0);

    // The take itself: lead-in, then the teleprompter must be legible and the
    // two-segment progress must appear.
    if (w === 390 && h === 844) {
      await rec.click();
      await p.waitForTimeout(900);
      const count = await p.locator("text=/^[123]$/").count();
      ok("3-2-1 lead-in is shown", count > 0);
      await p.screenshot({ path: `${OUT}/leadin-${w}.png` });
      await p.waitForTimeout(4000);
      ok("recording pill visible", (await p.getByText(/READING/).count()) > 0);
      const fs = await p.evaluate(() => {
        const ps = [...document.querySelectorAll("p")];
        const t = ps.find((e) => (e.textContent ?? "").length > 80 && e.closest(".absolute"));
        return t ? parseFloat(getComputedStyle(t).fontSize) : 0;
      });
      ok("teleprompter is legible (>=17px)", fs >= 17, `${fs}px`);
      const segs = await p.evaluate(() =>
        [...document.querySelectorAll("div")].filter((d) => d.className.includes("bg-white/25")).length);
      ok("two-segment progress is shown", segs === 2, `${segs} segment(s)`);
      // The prompter must crawl on its own: sample scrollTop across the read.
      const t1 = await p.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find((d) => d.className.includes("h-[46%]"));
        return el ? el.scrollTop : -1;
      });
      await p.waitForTimeout(9000);
      const t2 = await p.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find((d) => d.className.includes("h-[46%]"));
        return el ? { top: el.scrollTop, max: el.scrollHeight - el.clientHeight } : null;
      });
      ok("teleprompter auto-scrolls", Boolean(t2 && t2.top > t1), `${t1} -> ${t2?.top}/${t2?.max}`);
      await p.screenshot({ path: `${OUT}/recording-${w}.png` });
      await p.reload({ waitUntil: "networkidle" });
      await p.waitForTimeout(800);
      await dropDevBar();
    }

    // No sideways scroll, ever.
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok("no horizontal scroll", m.sw <= m.iw + 1, `${m.sw}/${m.iw}`);

    // Landscape must still be landscape.
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await dropDevBar();
    const land = p.getByText(/Landscape/i).first();
    if (await land.count()) await land.click();
    await p.getByRole("button", { name: /Start camera/i }).first().click({ timeout: 10_000 }).catch(() => {});
    await p.waitForTimeout(2500);
    const lbox = await p.locator("video").first().boundingBox();
    ok("landscape frame is landscape (w > h)", Boolean(lbox && lbox.width > lbox.height),
       lbox ? `${Math.round(lbox.width)}x${Math.round(lbox.height)}` : "no video box");
    await p.screenshot({ path: `${OUT}/preview-landscape-${w}.png` });
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
