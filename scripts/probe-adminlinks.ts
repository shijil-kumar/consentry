import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
const BASE = "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: prof } = await admin.from("profiles").select("id").eq("role","admin").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type:"magiclink", email: u.user!.email! });
  const pub = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type:"magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  await ctx.addCookies([{ name:`sb-${ref}-auth-token`, value:"base64-"+Buffer.from(JSON.stringify(sess!.session)).toString("base64"), domain:"consentry.app", path:"/", sameSite:"Lax" as const, secure:true }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin`, { waitUntil:"networkidle" });
  const links = await p.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")).filter(Boolean));
  console.log("all links:", JSON.stringify([...new Set(links)]));
  // The console is one page with anchor sections, not /admin/<x> routes.
  // Assert each anchor resolves to a section that actually rendered content.
  const anchors = await p.evaluate(() =>
    [...document.querySelectorAll("a[href^='#']")].map((a) => a.getAttribute("href")!.slice(1)));
  for (const id of [...new Set(anchors)]) {
    const info = await p.evaluate((x) => {
      const el = document.getElementById(x);
      if (!el) return null;
      const sec = el.closest("[data-slot=card]") ?? el;
      return { chars: (sec.textContent ?? "").trim().length, rows: sec.querySelectorAll("tr,li").length };
    }, id);
    console.log(`  anchor #${id.padEnd(14)} ${info ? `target found, ${info.chars} chars, ${info.rows} row(s)` : "MISSING TARGET"}`);
  }
  const cards = await p.evaluate(() => [...document.querySelectorAll("[data-slot=card]")].map(c => ({
    text: (c.textContent ?? "").trim().slice(0, 40),
    tag: c.tagName, clickable: Boolean(c.closest("a") || c.querySelector("a,button")),
  })));
  console.log("cards:", JSON.stringify(cards, null, 1).slice(0, 1600));
  await p.screenshot({ path: "C:/Temp/claude/C--Users-Arjun-Kumar-SAAS-Testing/426decb9-eb4c-4fc7-a7ca-c599a706dc0a/scratchpad/uicheck/admin-full.png", fullPage: true });
  await b.close();
})();
