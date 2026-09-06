 
// What happens when a creator who ALREADY has verified consent records again?
// Nothing in the UI stops them, and submit_consent always INSERTs, so the
// question is what the dashboards then claim about their protection status.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://consentry.app";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  // Must be a creator who ALREADY has verified consent — that is the whole
  // question. The generic "first creator" has none, so the interesting state
  // never arises and the test proves nothing.
  const { data: verified } = await admin.from("consent_records")
    .select("org_id").eq("status", "verified").order("created_at", { ascending: false }).limit(1).single();
  const { data: prof } = await admin.from("profiles")
    .select("id, org_id, display_name").eq("role", "creator").eq("org_id", verified!.org_id).limit(1).single();
  const { data: u } = await admin.auth.admin.getUserById(prof!.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess } = await pub.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  const ref = new URL(URL_).hostname.split(".")[0];
  const cookie = {
    name: `sb-${ref}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(sess!.session)).toString("base64"),
    domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https"),
  };

  const { data: existing } = await admin.from("consent_records")
    .select("id, status, created_at").eq("org_id", prof!.org_id)
    .order("created_at", { ascending: false });
  console.log(`existing consent records for ${prof!.display_name}: ` +
    (existing ?? []).map((c) => c.status).join(", "));

  const { data: avatar } = await admin.from("avatars")
    .select("id, status, consent_record_id").eq("org_id", prof!.org_id).limit(1).maybeSingle();
  console.log(`avatar: ${avatar?.status ?? "none"} bound to consent ${String(avatar?.consent_record_id).slice(0, 8)}`);

  const results: Array<{ label: string; route: string; verified: boolean; pending: boolean; warns: boolean }> = [];
  let fails = 0;
  const ok = (l: string, p: boolean, d = "") => {
    if (!p) fails++;
    console.log(`  ${p ? "ok  " : "FAIL"}  ${l}${d ? "  " + d : ""}`);
  };
  const browser = await chromium.launch();
  const read = async (label: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([cookie]);
    const p = await ctx.newPage();
    for (const route of ["/creator", "/creator/protection", "/creator/consent"]) {
      await p.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
      const txt = (await p.textContent("body")) ?? "";
      const status = /Consent (authenticity|verified|pending)/i.exec(txt)?.[0] ?? "";
      const verified = /Consent verified|Verified human/i.test(txt);
      const pending = /\bPending\b/i.test(txt);
      const warns = /already have|replace|supersede|re-?record/i.test(txt);
      console.log(`  ${label} ${route.padEnd(20)} verified=${verified} pending=${pending} warnsAboutRerecord=${warns} ${status}`);
      results.push({ label, route, verified, pending, warns });
    }
    await ctx.close();
  };

  console.log("\nBEFORE a second recording:");
  await read("BEFORE");

  // Stage exactly what a second take would produce: a new pending record.
  const { data: staged, error } = await admin.from("consent_records").insert({
    org_id: prof!.org_id, creator_id: prof!.id,
    consent_video_path: `${prof!.org_id}/probe-second-take.mp4`,
    content_hash: "1".repeat(64), consent_script_version: "probe",
    scope: { probe: true }, status: "pending",
  }).select("id").single();
  if (error) { console.log("could not stage:", error.message); process.exit(1); }

  console.log("\nAFTER a second (still unverified) recording:");
  await read("AFTER ");

  const { data: avatarAfter } = await admin.from("avatars")
    .select("status, consent_record_id").eq("id", avatar?.id ?? "").maybeSingle();
  console.log(`\navatar after: ${avatarAfter?.status ?? "n/a"} still bound to ` +
    `${String(avatarAfter?.consent_record_id).slice(0, 8)} (unchanged = generation still works)`);

  console.log("");
  console.log("assertions:");
  const before = results.filter((r) => r.label === "BEFORE");
  const after = results.filter((r) => r.label === "AFTER ");
  ok("a verified creator reads as verified before re-recording",
    before.find((r) => r.route === "/creator")?.verified === true);
  // THE REGRESSION: a second, still-unverified take used to flip the headline
  // status to "Pending" and hide the Revoke control, while the live replica
  // carried on generating under the grant it was trained on.
  ok("a newer unverified take does NOT unseat the verified status on /creator",
    after.find((r) => r.route === "/creator")?.verified === true,
    "dashboard claimed the creator was unprotected");
  ok("...nor on /creator/protection",
    after.find((r) => r.route === "/creator/protection")?.verified === true);
  ok("the recorder page warns a protected creator before they re-record",
    after.find((r) => r.route === "/creator/consent")?.warns === true);

  await admin.from("audit_log").delete().eq("target_id", staged!.id);
  await admin.from("consent_records").delete().eq("id", staged!.id);
  console.log("staged record removed");
  await browser.close();
  console.log(fails ? `${fails} FAILURE(S)` : "re-record flow behaved as intended");
  process.exit(fails ? 1 : 0);
})();
