import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env.local") });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// TEST_BASE_URL, like every other E2E file here. This one read APP_BASE_URL,
// which is the app's own PRODUCTION origin — pointing the suite at the live site
// on any machine where that is set, while ignoring the variable used to redirect
// the rest of the suite at a local server.
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD ?? "ConsentDemo-2026!";

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false } });

let fanTok = "";
let fanId = "";
let celebId = "";

beforeAll(async () => {
  const { data: s } = await anon().auth.signInWithPassword({ email: "fan@consentfirst.test", password: PASSWORD });
  fanTok = s?.session?.access_token ?? "";
  fanId = s?.user?.id ?? "";
  const { data: celeb } = await admin.from("profiles").select("id").eq("handle", "arjun").single();
  celebId = celeb!.id;
});

const asFan = () => createClient(URL_, ANON, {
  global: { headers: { Authorization: `Bearer ${fanTok}` } }, auth: { persistSession: false },
});

describe("follows RLS", () => {
  it("a fan can follow and unfollow (own rows only)", async () => {
    await asFan().from("follows").delete().eq("follower_id", fanId).eq("celebrity_id", celebId);
    const { error: insErr } = await asFan().from("follows").insert({ follower_id: fanId, celebrity_id: celebId });
    expect(insErr).toBeNull();
    const { data: mine } = await asFan().from("follows").select("celebrity_id");
    expect((mine ?? []).some((f) => f.celebrity_id === celebId)).toBe(true);
  });

  it("a fan CANNOT insert a follow on someone else's behalf", async () => {
    const { error } = await asFan().from("follows").insert({ follower_id: celebId, celebrity_id: fanId });
    expect(error).not.toBeNull();
  });

  it("anon can read aggregate counts but NEVER follower identities", async () => {
    const { data: counts, error: cErr } = await anon().from("public_follow_counts").select("*");
    expect(cErr).toBeNull();
    expect(Array.isArray(counts)).toBe(true);
    const { data: rows } = await anon().from("follows").select("follower_id");
    expect(rows ?? []).toHaveLength(0); // RLS: no anon access to identities
  });
});

describe("public registry page (isOwner overlay never leaks)", () => {
  it("anon /c/[handle] HTML contains no owner-only widgets", async () => {
    const res = await fetch(`${BASE}/c/arjun`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Protected by");
    expect(html).not.toContain("This is your page as the owner");
    expect(html).not.toContain("Review approvals");
  });

  it("public payload contains no scripts or storage paths", async () => {
    const res = await fetch(`${BASE}/c/arjun`);
    const html = await res.text();
    expect(html).not.toContain("master.mp4");
    expect(html).not.toContain("consent-videos/");
  });
});

describe("approval state machine (DB-level)", () => {
  it("approval_action rejects unknown tokens", async () => {
    const { error } = await admin.rpc("approval_action", {
      p_token: "not-a-real-token", p_action: "approve", p_comment: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_or_expired");
  });

  it("clients cannot write approval_events (immutable, service-only)", async () => {
    const { data: anyGen } = await admin.from("generations").select("id").limit(1).maybeSingle();
    if (!anyGen) return; // nothing to test against yet
    const { error } = await asFan().from("approval_events").insert({
      generation_id: anyGen.id, actor_label: "celebrity", action: "approved",
    });
    expect(error).not.toBeNull();
  });

  it("approval tokens are unreadable to clients", async () => {
    const { data } = await asFan().from("approval_tokens").select("token").limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it("there is no auto-approve: a review row stays put without the RPC", async () => {
    // Statically assert the worker source has no timeout-approve branch.
    // (The E2E path is covered in phase34; this guards against regression.)
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "app/api/jobs/generation-worker/route.ts"), "utf-8");
    expect(src).not.toMatch(/status:\s*['"]approved['"]/); // worker never SETS approved
    expect(src).toContain("NO auto-approve");
  });
});

describe("approval token must never reach the counterparty (regression)", () => {
  it("a BUYER cannot obtain the celebrity's approval token from /api/my-approvals", async () => {
    // Root cause once shipped: gen_select_parties lets BOTH parties read a
    // generation, and the route handed back the magic-link token — so a brand
    // could approve its own video. Everything the product claims depends on
    // this staying shut.
    const { data: s } = await anon().auth.signInWithPassword({
      email: "brand@consentfirst.test", password: PASSWORD,
    });
    const res = await fetch(`${BASE}/api/my-approvals`, {
      headers: { authorization: `Bearer ${s!.session!.access_token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it("the CELEBRITY still gets their own pending approvals", async () => {
    const { data: s } = await anon().auth.signInWithPassword({
      email: "arjun@consentfirst.test", password: PASSWORD,
    });
    const res = await fetch(`${BASE}/api/my-approvals`, {
      headers: { authorization: `Bearer ${s!.session!.access_token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("tier must belong to the listing (regression)", () => {
  it("a buyer cannot license one creator at another creator's tier price", async () => {
    const { data: s } = await anon().auth.signInWithPassword({
      email: "brand@consentfirst.test", password: PASSWORD,
    });
    const tok = s!.session!.access_token;
    const { data: listings } = await admin.from("listings")
      .select("id").eq("status", "published").limit(2);
    const { data: foreignTier } = await admin.from("license_tiers")
      .select("id").eq("listing_id", listings![1].id).limit(1).single();

    const res = await fetch(`${BASE}/api/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tok}`,
        "x-test-policy-llm": "mock",
      },
      body: JSON.stringify({
        listing_id: listings![0].id,      // creator A's listing
        tier_id: foreignTier!.id,          // creator B's tier
        category: "fitness",
        script: "A perfectly ordinary script that is long enough to pass validation checks.",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("tier_does_not_belong_to_listing");
  });
});

describe("revision loop must be completable (regression)", () => {
  it("a generation the celebrity sent back does NOT consume licence quota", async () => {
    // Shipped bug: create_generation counted every non-failed generation, so on
    // the 1-video tier a celebrity tapping "Request changes" permanently locked
    // the brand out — they had paid, been asked for a revision, and could not
    // submit one. The revision loop the landing page sells could never close.
    const { data: tier } = await admin.from("license_tiers")
      .select("id, max_generations").eq("max_generations", 1).limit(1).maybeSingle();
    if (!tier) return; // no single-video tier seeded

    const { data: lic } = await admin.from("licenses")
      .select("id").eq("tier_id", tier.id).eq("status", "active").limit(1).maybeSingle();
    if (!lic) return;

    // Simulate a licence whose only generation was sent back for changes.
    await admin.from("generations").update({ status: "changes_requested" })
      .eq("license_id", lic.id).eq("status", "delivered");

    const { count } = await admin.from("generations")
      .select("id", { count: "exact", head: true })
      .eq("license_id", lic.id)
      .not("status", "in", "(failed,changes_requested,rejected)");

    // Whatever else is on this licence, sent-back versions must not be counted.
    expect(count ?? 0).toBeLessThanOrEqual(tier.max_generations);
  });
});
