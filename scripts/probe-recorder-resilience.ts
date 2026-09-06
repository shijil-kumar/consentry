/* eslint-disable @typescript-eslint/no-explicit-any */
// Behavioural tests for the consent recorder's failure paths. These are the
// things that cost a creator a whole 65-second take in the real world and that
// no screenshot can show:
//
//   1. The screen must be held awake for the take (the second half is 30s of
//      silence, so an auto-locking phone would otherwise lock mid-consent, and
//      iOS suspends capture the moment it does).
//   2. If the page IS hidden mid-take, the recording must fail honestly rather
//      than submit truncated footage as a consent artifact.
//   3. On any failure the camera must actually shut off — a recorder that
//      leaves the camera light on after an error is its own privacy bug.
//   4. Leaving the page mid-take must be guarded.
//   5. A full 65s take must reach review with real footage.
import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page, type BrowserContext } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SPEAK = 35, STILL = 30;   // must mirror the recorder's constants

let fails = 0;
const ok = (l: string, p: boolean, d = "") => { if (!p) fails++; console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`); };

async function creatorCookie() {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", "creator").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  return { name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64"),
           domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https") };
}

/** Open the recorder and roll, leaving the page mid-take. */
async function rollCamera(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  // Count wake-lock requests, and let us fake "the screen just locked".
  //
  // Passed as a RAW STRING, not a function: tsx compiles inline arrow functions
  // with an esbuild `__name` helper that does not exist in the page, so a
  // function form dies with "__name is not defined" partway through — leaving
  // half the stubs installed and the test silently measuring nothing.
  await p.addInitScript({ content: `
    window.__wake = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: function () {
        window.__wake.requests++;
        return Promise.resolve({
          release: function () { window.__wake.releases++; return Promise.resolve(); },
          addEventListener: function () {},
        });
      } },
    });
    var __hidden = false;
    window.__setHidden = function (v) {
      __hidden = v;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    Object.defineProperty(document, "hidden", { get: function () { return __hidden; }, configurable: true });
    Object.defineProperty(document, "visibilityState", {
      get: function () { return __hidden ? "hidden" : "visible"; }, configurable: true,
    });
  ` });
  await p.goto(`${BASE}/creator/consent`, { waitUntil: "networkidle", timeout: 60_000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('div.fixed.bottom-3[class*="z-["]')?.remove());
  await p.getByRole("button", { name: /Start camera/i }).first().click();
  await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /Start recording/i }).first().click();
  await p.waitForTimeout(4200);                       // clear the 3-2-1 lead-in
  return p;
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const cookie = await creatorCookie();
  const newCtx = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      permissions: ["camera", "microphone"] });
    await c.addCookies([cookie]);
    return c;
  };

  // ── 1 + 2 + 3: wake lock, honest interruption, camera shutdown ───────────
  console.log("\n=== screen lock / backgrounding mid-take ===");
  {
    const ctx = await newCtx();
    const p = await rollCamera(ctx);
    ok("recording actually started", (await p.getByText(/READING/).count()) > 0);
    const wake = await p.evaluate(() => (window as any).__wake.requests);
    ok("screen wake lock requested for the take", wake >= 1, `${wake} request(s)`);

    await p.evaluate(() => (window as any).__setHidden(true));
    await p.waitForTimeout(1200);
    const msg = (await p.textContent("body")) ?? "";
    ok("interruption is reported honestly, not swallowed",
       /screen switched away or locked/i.test(msg));
    ok("the creator is told how to prevent it", /screen timeout/i.test(msg));

    const camOff = await p.evaluate(() => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      const st = v?.srcObject as MediaStream | null;
      return !st || st.getTracks().every((t) => t.readyState === "ended");
    });
    ok("camera is switched off after the failure", camOff);
    const released = await p.evaluate(() => (window as any).__wake.releases);
    ok("wake lock released after the failure", released >= 1, `${released} release(s)`);
    await ctx.close();
  }

  // ── 4: navigating away mid-take is guarded ──────────────────────────────
  console.log("\n=== leaving the page mid-take ===");
  {
    const ctx = await newCtx();
    const p = await rollCamera(ctx);
    const guarded = await p.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    ok("closing the tab mid-take is guarded", guarded);
    await ctx.close();
  }

  // ── 5: a full 65-second take reaches review with real footage ───────────
  console.log("\n=== full 65s take (this is slow on purpose) ===");
  {
    const ctx = await newCtx();
    const p = await rollCamera(ctx);
    await p.waitForTimeout(36_000);
    ok("second half switches to the still segment", (await p.getByText(/HOLD STILL/).count()) > 0);
    await p.getByText(/Use this take|Retake/i).first().waitFor({ timeout: 60_000 }).catch(() => {});
    const review = await p.evaluate(() => {
      const v = [...document.querySelectorAll("video")].find((x) => x.src.startsWith("blob:"));
      return v ? { src: true, dur: v.duration } : null;
    });
    ok("take reaches review with playable footage", Boolean(review?.src),
       review ? `duration=${Number.isFinite(review.dur) ? review.dur.toFixed(1) + "s" : "n/a"}` : "no blob video");

    // REGRESSION GUARD. The still half once collapsed to ~1 second because the
    // countdown called its completion handler from inside a setState updater,
    // so takes came out 36s instead of 65s with the replica-training footage
    // missing. Nothing short of a full-length take catches that.
    const dur = review?.dur ?? 0;
    ok("recorded take is the full length, not truncated",
       Number.isFinite(dur) && dur >= (SPEAK + STILL) * 0.9,
       `${Number.isFinite(dur) ? dur.toFixed(1) : "?"}s of an expected ~${SPEAK + STILL}s`);
    ok("retake and submit are both offered",
       (await p.getByRole("button", { name: /Retake|Record again/i }).count()) > 0 &&
       (await p.getByRole("button", { name: /Use this take|Submit/i }).count()) > 0);
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nall resilience checks passed");
  process.exit(fails ? 1 : 0);
})();
