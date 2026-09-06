import { config } from "dotenv"; import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", "admin").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64"), domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: true }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle", timeout: 60_000 });
  await p.waitForTimeout(1500);
  const rows = await p.evaluate(() => {
    const card = [...document.querySelectorAll("[data-slot=card]")]
      .find((c) => /Is the demo ready/i.test(c.textContent ?? ""));
    if (!card) return null;
    return {
      verdict: /Not ready[^.]*\.|Ready to demo[^.]*\./i.exec(card.textContent ?? "")?.[0] ?? "?",
      items: [...card.querySelectorAll("svg")].length,
      text: (card.textContent ?? "").replace(/\s+/g, " ").slice(0, 900),
    };
  });
  console.log("verdict:", rows?.verdict);
  console.log("\npanel:\n", rows?.text);
  await b.close();
})();
