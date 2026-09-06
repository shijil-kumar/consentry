/* eslint-disable @typescript-eslint/no-explicit-any */
// Visual + speed review of the demo path, as a fresh pair of eyes.
//
// The automated suites assert structure and behaviour. This captures what they
// cannot judge: how each screen LOOKS and how fast it FEELS. Every core page is
// screenshotted at desktop and phone for human review, and timed with real
// browser metrics (TTFB, first contentful paint, largest contentful paint,
// layout shift) — because "loads fast" is a claim about paint, not about fetch.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const OUT = "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/visual";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function sessionFor(role: string) {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", role).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  return s!.session!;
}
const cookieFor = (session: any) => ({
  name: `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`,
  value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64"),
  domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: true,
});

/** Web-vitals-ish numbers from the page itself. */
async function vitals(p: Page) {
  return p.evaluate(async () => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((e) => e.name === "first-contentful-paint")?.startTime ?? null;
    // LCP requires an observer; buffered entries let us read it after the fact.
    const lcp: number | null = await new Promise((resolve) => {
      let last: number | null = null;
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) last = e.startTime;
        });
        po.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => { po.disconnect(); resolve(last); }, 600);
      } catch { resolve(null); }
    });
    let cls = 0;
    try {
      const po2 = new PerformanceObserver(() => {});
      po2.observe({ type: "layout-shift", buffered: true });
      for (const e of performance.getEntriesByType("layout-shift") as any[]) {
        if (!e.hadRecentInput) cls += e.value;
      }
      po2.disconnect();
    } catch { /* not supported */ }
    return {
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      fcp: fcp === null ? null : Math.round(fcp),
      lcp: lcp === null ? null : Math.round(lcp),
      cls: Math.round(cls * 1000) / 1000,
      transferKB: Math.round((nav.transferSize ?? 0) / 1024),
    };
  });
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const buyerSession = await sessionFor("buyer");
  const creatorSession = await sessionFor("creator");

  // The most recent paid request gives us a real workspace to look at.
  const { data: req } = await admin.from("approval_requests")
    .select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: gen } = await admin.from("generations")
    .select("id").eq("status", "delivered").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const PAGES: Array<{ route: string; who: "anon" | "buyer" | "creator"; note: string }> = [
    { route: "/", who: "anon", note: "landing" },
    { route: "/celebrities", who: "anon", note: "registry" },
    { route: "/c/arjun", who: "anon", note: "creator public page" },
    { route: "/marketplace", who: "buyer", note: "marketplace" },
    ...(req ? [{ route: `/buyer/requests/${(req as any).id}`, who: "buyer" as const, note: "request workspace" }] : []),
    ...(gen ? [{ route: `/verify/${(gen as any).id}`, who: "anon" as const, note: "public verify" }] : []),
    { route: "/inspect", who: "anon", note: "inspect" },
    { route: "/creator", who: "creator", note: "creator studio" },
    { route: "/creator/consent", who: "creator", note: "consent recorder" },
  ];

  console.log("route".padEnd(30), "view".padEnd(8), "TTFB".padStart(6), "FCP".padStart(6), "LCP".padStart(6), "CLS".padStart(6), "  KB".padStart(6));
  const rows: any[] = [];

  for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 2,
      });
      if (pg.who === "buyer") await ctx.addCookies([cookieFor(buyerSession)]);
      if (pg.who === "creator") await ctx.addCookies([cookieFor(creatorSession)]);
      const p = await ctx.newPage();
      await p.goto(`${BASE}${pg.route}`, { waitUntil: "networkidle", timeout: 60_000 });
      await p.waitForTimeout(800);
      const v = await vitals(p);
      rows.push({ ...pg, tag, ...v });
      console.log(
        pg.route.slice(0, 29).padEnd(30), tag.padEnd(8),
        `${v.ttfb}`.padStart(6), `${v.fcp ?? "-"}`.padStart(6),
        `${v.lcp ?? "-"}`.padStart(6), `${v.cls}`.padStart(6), `${v.transferKB}`.padStart(6),
      );
      const safe = pg.route.replace(/\//g, "_").replace(/^_$/, "home").slice(0, 50) || "home";
      await p.screenshot({ path: `${OUT}/${tag}-${safe}.png`, fullPage: false });
      await ctx.close();
    }
  }

  // Anything slow enough to feel slow gets called out.
  console.log("\nfeels-slow list (LCP > 2500ms or TTFB > 800ms):");
  const slow = rows.filter((r) => (r.lcp ?? 0) > 2500 || r.ttfb > 800);
  if (!slow.length) console.log("  none — every page paints inside budget");
  for (const s of slow) console.log(`  ${s.tag.padEnd(8)} ${s.route}  TTFB=${s.ttfb}ms LCP=${s.lcp}ms`);

  await browser.close();
})();
