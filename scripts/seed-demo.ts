/**
 * B9.1 — demo seed. Idempotent-ish: deletes prior seed users by email, then
 * rebuilds the whole demo world against the LIVE Supabase project using the
 * mock provider (zero cost). Run: npm run seed:demo
 *
 * Creates: Arjun (creator, ready replica, published listing + 3 tiers +
 * PC-03 medical clause), 2 filler creators, a brand buyer, an admin.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createHash } from "node:crypto";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

const PASSWORD = "ConsentDemo-2026!";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const USERS = [
  { email: "arjun@consentfirst.test", role: "creator", name: "Arjun Menon", handle: "arjun" },
  { email: "aisha@consentfirst.test", role: "creator", name: "Aisha Rahman", handle: "aisha" },
  { email: "vikram@consentfirst.test", role: "creator", name: "Vikram Rao", handle: "vikram" },
  { email: "meera@consentfirst.test", role: "creator", name: "Meera Pillai", handle: "meera" },
  { email: "arjun@consentfirst.test", role: "creator", name: "Arjun Bedi", handle: "arjun" },
  { email: "divya@consentfirst.test", role: "creator", name: "Divya Sharma", handle: "divya" },
  { email: "brand@consentfirst.test", role: "buyer", name: "Acme Wellness", handle: null },
  { email: "fan@consentfirst.test", role: "fan", name: "Demo Fan", handle: null },
  { email: "admin@consentfirst.test", role: "admin", name: "Platform Admin", handle: null },
] as const;

async function findUserByEmail(email: string) {
  // paginate through users (demo scale is tiny)
  for (let page = 1; page <= 5; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => x.email === email);
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

async function reset() {
  for (const u of USERS) {
    const existing = await findUserByEmail(u.email);
    if (existing) {
      const { data: prof } = await admin.from("profiles").select("org_id").eq("id", existing.id).single();
      if (prof) {
        // cascade cleanup for this org
        const org = prof.org_id;
        const { data: gens } = await admin.from("generations").select("id").or(`buyer_org_id.eq.${org},creator_org_id.eq.${org}`);
        for (const g of gens ?? []) await admin.storage.from("deliverables").remove([`${org}/${g.id}/final.mp4`]).catch(() => {});
        await admin.from("payouts").delete().eq("org_id", org);
        await admin.from("generations").delete().or(`buyer_org_id.eq.${org},creator_org_id.eq.${org}`);
        await admin.from("licenses").delete().or(`buyer_org_id.eq.${org},creator_org_id.eq.${org}`);
        await admin.from("approval_requests").delete().or(`buyer_org_id.eq.${org},creator_org_id.eq.${org}`);
        const { data: listings } = await admin.from("listings").select("id").eq("org_id", org);
        for (const l of listings ?? []) {
          await admin.from("listing_prohibited_uses").delete().eq("listing_id", l.id);
          await admin.from("license_tiers").delete().eq("listing_id", l.id);
        }
        await admin.from("listings").delete().eq("org_id", org);
        await admin.from("avatars").delete().eq("org_id", org);
        const { data: consents } = await admin.from("consent_records").select("consent_video_path").eq("org_id", org);
        for (const c of consents ?? []) await admin.storage.from("consent-videos").remove([c.consent_video_path]).catch(() => {});
        await admin.from("consent_records").delete().eq("org_id", org);
      }
      await admin.auth.admin.deleteUser(existing.id);
      if (prof) await admin.from("orgs").delete().eq("id", prof.org_id);
    }
  }
  console.log("· cleared prior seed");
}

async function createUser(u: (typeof USERS)[number]) {
  let { data, error } = await admin.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true,
    user_metadata: { role: u.role === "admin" ? "buyer" : u.role, display_name: u.name, ...(u.handle ? { handle: u.handle } : {}) },
  });
  if (error && /already been registered/i.test(error.message)) {
    // orphan from an interrupted run — remove and retry once
    const existing = await findUserByEmail(u.email);
    if (existing) await admin.auth.admin.deleteUser(existing.id);
    ({ data, error } = await admin.auth.admin.createUser({
      email: u.email, password: PASSWORD, email_confirm: true,
      user_metadata: { role: u.role === "admin" ? "buyer" : u.role, display_name: u.name, ...(u.handle ? { handle: u.handle } : {}) },
    }));
  }
  if (error) throw error;
  const id = data.user!.id;
  const { data: prof } = await admin.from("profiles").select("org_id").eq("id", id).single();
  // admin role is never self-assignable via signup metadata — set it here (server)
  if (u.role === "admin") {
    await admin.from("profiles").update({ role: "admin" }).eq("id", id);
    await admin.from("orgs").update({ type: "platform" }).eq("id", prof!.org_id);
  }
  if (u.role === "fan") {
    await admin.from("profiles").update({ role: "fan" }).eq("id", id); // in case the signup trigger defaulted it
  }
  return { id, orgId: prof!.org_id };
}

async function makeCreatorLive(userId: string, orgId: string, handle: string, opts: {
  title: string; bio: string; categories: string[]; clauseCodes: string[]; publish: boolean;
  isDemo?: boolean; consentVerified?: boolean;
}) {
  const verified = opts.consentVerified !== false;
  // consent (pending) via RPC path emulation → directly insert + verify
  const videoPath = `${orgId}/consent-seed-${handle}.webm`;
  await admin.storage.from("consent-videos").upload(videoPath, new Blob([`seed-${handle}-`.repeat(3000)], { type: "video/webm" }), { upsert: true });
  // submit_consent requires auth.uid(); the seed uses the service client's
  // BYPASSRLS to insert a pre-verified consent row directly.
  const { data: consent, error: cErr } = await admin.from("consent_records").insert({
    org_id: orgId, creator_id: userId, consent_video_path: videoPath,
    content_hash: sha(`seed-${handle}`), consent_script_version: "v1",
    scope: { commercial_endorsement: true, territories: ["IN"] },
    voice_captcha: { verified, method: "seed" },
    status: "verified", verified_at: new Date().toISOString(),
  }).select("id").single();
  if (cErr) throw cErr;

  const { data: avatar } = await admin.from("avatars").insert({
    org_id: orgId, creator_id: userId, consent_record_id: consent!.id,
    provider: "mock", provider_replica_id: `mock-r-seed-${handle}`, status: "ready",
  }).select("id").single();

  const { data: listing } = await admin.from("listings").insert({
    org_id: orgId, creator_id: userId, avatar_id: avatar!.id,
    title: opts.title, bio: opts.bio, allowed_categories: opts.categories, status: "draft",
    is_demo: opts.isDemo ?? false,
  }).select("id").single();

  const tiers = [
    { name: "Single Ad", price_paise: 499900, duration_days: 7, max_generations: 1, exclusivity: "none", sort_order: 1 },
    { name: "30-Day Campaign", price_paise: 1499900, duration_days: 30, max_generations: 4, exclusivity: "none", sort_order: 2 },
    { name: "Exclusive", price_paise: 4999900, duration_days: 30, max_generations: 10, exclusivity: "category", sort_order: 3 },
  ];
  await admin.from("license_tiers").insert(tiers.map((t) => ({ ...t, org_id: orgId, listing_id: listing!.id })));

  if (opts.clauseCodes.length) {
    const { data: clauses } = await admin.from("policy_clauses").select("id, code").in("code", opts.clauseCodes);
    await admin.from("listing_prohibited_uses").insert((clauses ?? []).map((c) => ({ listing_id: listing!.id, clause_id: c.id })));
  }
  if (opts.publish) {
    const { error } = await admin.from("listings").update({ status: "published" }).eq("id", listing!.id);
    if (error) throw new Error(`publish ${handle}: ${error.message}`);
  }
  // Demo-only: downgrade AFTER publish so the grid shows a live "Consent
  // pending" card (the publish gate itself — correctly — refuses unverified).
  if (!verified) {
    await admin.from("consent_records").update({ status: "pending", verified_at: null }).eq("id", consent!.id);
  }
  return { consentId: consent!.id, listingId: listing!.id };
}

async function main() {
  await reset();
  const created: Record<string, { id: string; orgId: string }> = {};
  for (const u of USERS) {
    created[u.email] = await createUser(u);
    console.log(`· ${u.role.padEnd(7)} ${u.email}`);
  }

  await admin.from("profiles").update({
    no_go_list: "politics, alcohol, tobacco, gambling or betting apps, rival fitness-band brands",
    avatar_url: "/avatars/arjun.jpg", // real headshot shipped in public/avatars
  }).eq("id", created["arjun@consentfirst.test"].id);
  // demo fan follows arjun so the fan feed is never empty
  await admin.from("follows").upsert({
    follower_id: created["fan@consentfirst.test"].id,
    celebrity_id: created["arjun@consentfirst.test"].id,
  }, { onConflict: "follower_id,celebrity_id", ignoreDuplicates: true });
  await makeCreatorLive(created["arjun@consentfirst.test"].id, created["arjun@consentfirst.test"].orgId, "arjun", {
    title: "Tech & fitness creator — honest, high-energy endorsements",
    bio: "I only work with products I'd actually use. Clear rules, fast turnarounds.",
    categories: ["tech", "fitness", "fashion"],
    clauseCodes: ["PC-03", "PC-04", "PC-02"],
    publish: true,
  });
  await makeCreatorLive(created["aisha@consentfirst.test"].id, created["aisha@consentfirst.test"].orgId, "aisha", {
    title: "Beauty & lifestyle — warm, trusted recommendations",
    bio: "Skincare, home, and travel brands that fit my audience.",
    categories: ["beauty", "home", "travel"],
    clauseCodes: ["PC-03", "PC-05"],
    publish: true, isDemo: true,
  });
  await makeCreatorLive(created["vikram@consentfirst.test"].id, created["vikram@consentfirst.test"].orgId, "vikram", {
    title: "Food & gaming creator",
    bio: "Playful, punchy endorsements for food and gaming brands.",
    categories: ["food", "gaming", "tech"],
    clauseCodes: ["PC-01", "PC-10"],
    publish: true, isDemo: true,
  });
  await makeCreatorLive(created["meera@consentfirst.test"].id, created["meera@consentfirst.test"].orgId, "meera", {
    title: "Travel & wellness storyteller",
    bio: "Calm, cinematic brand stories for travel, wellness and premium D2C.",
    categories: ["travel", "wellness", "home"],
    clauseCodes: ["PC-03", "PC-04"],
    publish: true, isDemo: true,
  });
  await makeCreatorLive(created["arjun@consentfirst.test"].id, created["arjun@consentfirst.test"].orgId, "arjun", {
    title: "Auto & gadgets reviewer — consent pending",
    bio: "Cars, bikes and gadgets with a no-hype review style.",
    categories: ["auto", "tech"],
    clauseCodes: ["PC-04"],
    publish: true, isDemo: true, consentVerified: false, // demos the Verified-only toggle
  });
  await makeCreatorLive(created["divya@consentfirst.test"].id, created["divya@consentfirst.test"].orgId, "divya", {
    title: "Food & family lifestyle creator",
    bio: "Everyday cooking and family-first brand collaborations.",
    categories: ["food", "home", "beauty"],
    clauseCodes: ["PC-03", "PC-01", "PC-05"],
    publish: true, isDemo: true,
  });

  console.log("\n✓ demo world seeded. Logins (password: " + PASSWORD + "):");
  for (const u of USERS) console.log(`   ${u.role.padEnd(7)} ${u.email}`);
  console.log("\nDemo fixture scripts (paste into a script request against Arjun):");
  console.log("  A (auto-approve): I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely the best I have used. Check them out at aerofit.in.");
  console.log("  B (blocked PC-03): Doctors do not want you to know this: BurnMax capsules melted 8 kg off me in 3 weeks and normalized my blood sugar. Use code ARJUN.");
  console.log("  C (review PC-04): Big news for my portfolio this month. I have partnered with WealthNest, the only money app I genuinely trust.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
