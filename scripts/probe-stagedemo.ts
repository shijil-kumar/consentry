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
(async () => {
  const { data: prof } = await admin.from("profiles").select("id").eq("role", "admin").limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.addCookies([{ name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64"), domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: true }]);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));

  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle", timeout: 60_000 });
  await p.waitForTimeout(1200);
  const verdict = async () => (await p.evaluate(() => {
    const c = [...document.querySelectorAll("[data-slot=card]")].find((x) => /Is the demo ready/i.test(x.textContent ?? ""));
    return /Not ready[^.]*\.|Ready to demo[^.]*\./i.exec(c?.textContent ?? "")?.[0] ?? "?";
  }));
  console.log(`  before: ${await verdict()}`);

  const btn = p.getByRole("button", { name: /Stage the demo/i }).first();
  ok("the Stage the demo button is present", (await btn.count()) > 0);
  await btn.click();
  // The panel itself says this takes about 20 seconds. Wait for the completion
  // SIGNAL, not a guessed sleep — an earlier version reloaded after 9s and
  // cancelled the in-flight request, then reported the button as broken.
  await p.getByText(/Your review link/i).waitFor({ timeout: 90_000 }).catch(() => {});
  const staged = await p.getByText(/Your review link/i).count();
  ok("staging reports success with a review link", staged > 0);
  const shownError = await p.locator("p.text-destructive").count();
  ok("staging surfaced no error", shownError === 0,
     shownError ? ((await p.locator("p.text-destructive").first().textContent()) ?? "") : "");
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const after = await verdict();
  console.log(`  after:  ${after}`);
  ok("staging makes the demo report itself ready", /Ready to demo/i.test(after), after);

  const { count: tokens } = await admin.from("approval_tokens")
    .select("token", { count: "exact", head: true }).is("used_at", null);
  ok("an unused approval link is staged for the walkthrough", (tokens ?? 0) > 0, `${tokens} token(s)`);
  const { count: review } = await admin.from("generations")
    .select("id", { count: "exact", head: true }).eq("status", "celebrity_review");
  ok("a video is waiting for the celebrity's yes", (review ?? 0) > 0, `${review} awaiting`);
  ok("no console errors while staging", errors.length === 0, errors[0] ?? "");

  await b.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nthe demo stages cleanly and reports itself ready");
  process.exit(fails ? 1 : 0);
})();
