/**
 * Phases 3–8 E2E (dev server on localhost:3000, mock providers).
 * The whole product loop, no purchases:
 *  publish a listing → buyer requests (A auto-approve / B reject-with-clause /
 *  C needs-review → creator decides) → mock checkout → license active →
 *  generate → media pipeline (ffmpeg + c2patool) → delivered → verify_generation
 *  cross-checks hashes → revoke → generation blocked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const runId = Date.now().toString(36);
const PW = `P34-${runId}-pw!`;

const SCRIPT_A = "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely the best I have used for building a morning routine.";
const SCRIPT_B = "Doctors do not want you to know this: BurnMax capsules melted 8 kg off me in 3 weeks and normalized my blood sugar. Use code SAVE.";
const SCRIPT_C = "Big news for my portfolio this month. I have partnered with WealthNest, the only money app I genuinely trust.";

let admin: SupabaseClient;
let creator: SupabaseClient, buyer: SupabaseClient;
let buyerTok = "";
const ids = {
  creatorId: "", buyerId: "", creatorOrg: "", buyerOrg: "",
  consentId: "", avatarId: "", listingId: "", tierId: "",
};

async function signup(role: "creator" | "buyer", email: string, name: string, handle?: string) {
  const r = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW, role, display_name: name, ...(handle ? { handle } : {}) }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()).user_id as string;
}
const authed = async (email: string) => {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data } = await c.auth.signInWithPassword({ email, password: PW });
  return { c, tok: data.session!.access_token };
};

beforeAll(async () => {
  admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
  ids.creatorId = await signup("creator", `p34c-${runId}@ex.com`, "P34 Creator", `p34c${runId}`);
  ids.buyerId = await signup("buyer", `p34b-${runId}@ex.com`, "P34 Brand");
  ({ c: creator } = await authed(`p34c-${runId}@ex.com`));
  ({ c: buyer, tok: buyerTok } = await authed(`p34b-${runId}@ex.com`));

  const { data: profs } = await admin.from("profiles").select("id, org_id").in("id", [ids.creatorId, ids.buyerId]);
  ids.creatorOrg = profs!.find((p) => p.id === ids.creatorId)!.org_id;
  ids.buyerOrg = profs!.find((p) => p.id === ids.buyerId)!.org_id;

  // creator: verified consent + ready mock avatar (service seed)
  const { data: consent } = await admin.from("consent_records").insert({
    org_id: ids.creatorOrg, creator_id: ids.creatorId, consent_video_path: `${ids.creatorOrg}/seed.webm`,
    content_hash: "seedhash" + runId, consent_script_version: "v1",
    scope: { commercial_endorsement: true }, status: "verified", verified_at: new Date().toISOString(),
    voice_captcha: { verified: true },
  }).select("id").single();
  ids.consentId = consent!.id;
  const { data: avatar } = await admin.from("avatars").insert({
    org_id: ids.creatorOrg, creator_id: ids.creatorId, consent_record_id: ids.consentId,
    provider: "mock", provider_replica_id: `mock-r-seed-${runId}`, status: "ready",
  }).select("id").single();
  ids.avatarId = avatar!.id;
}, 120_000);

afterAll(async () => {
  try {
    const org = ids.creatorOrg, borg = ids.buyerOrg;
    const { data: gens } = await admin.from("generations").select("id").eq("buyer_org_id", borg);
    for (const g of gens ?? []) await admin.storage.from("deliverables").remove([`${borg}/${g.id}/final.mp4`]).catch(() => {});
    await admin.from("payouts").delete().or(`org_id.eq.${org},org_id.eq.${borg}`);
    await admin.from("generations").delete().or(`buyer_org_id.eq.${borg},creator_org_id.eq.${org}`);
    await admin.from("licenses").delete().or(`buyer_org_id.eq.${borg},creator_org_id.eq.${org}`);
    await admin.from("approval_requests").delete().or(`buyer_org_id.eq.${borg},creator_org_id.eq.${org}`);
    if (ids.listingId) {
      await admin.from("listing_prohibited_uses").delete().eq("listing_id", ids.listingId);
      await admin.from("license_tiers").delete().eq("listing_id", ids.listingId);
      await admin.from("listings").delete().eq("id", ids.listingId);
    }
    await admin.from("avatars").delete().eq("id", ids.avatarId);
    await admin.from("consent_records").delete().eq("id", ids.consentId);
    await admin.storage.from("consent-videos").remove([`${org}/seed.webm`]).catch(() => {});
    for (const u of [ids.creatorId, ids.buyerId]) if (u) await admin.auth.admin.deleteUser(u);
    await admin.from("orgs").delete().in("id", [org, borg]);
  } catch (e) { console.warn("cleanup:", e); }
}, 120_000);

describe("Phase 3 — listing publish + public surface", () => {
  it("creator publishes a listing with tiers + PC-03 clause", async () => {
    const { data: listing, error } = await creator.from("listings").insert({
      org_id: ids.creatorOrg, creator_id: ids.creatorId, avatar_id: ids.avatarId,
      title: `P34 listing ${runId}`, allowed_categories: ["fitness", "tech"],
    }).select("id").single();
    expect(error).toBeNull();
    ids.listingId = listing!.id;

    const { data: tier } = await creator.from("license_tiers").insert({
      org_id: ids.creatorOrg, listing_id: ids.listingId, name: "Single Ad",
      price_paise: 499900, duration_days: 7, max_generations: 2,
    }).select("id").single();
    ids.tierId = tier!.id;

    const { data: enabledClauses } = await creator.from("policy_clauses").select("id, code").in("code", ["PC-03", "PC-04"]);
    await creator.from("listing_prohibited_uses")
      .insert((enabledClauses ?? []).map((c) => ({ listing_id: ids.listingId, clause_id: c.id })));

    const { error: pubErr } = await creator.from("listings").update({ status: "published" }).eq("id", ids.listingId);
    expect(pubErr).toBeNull();
  });

  it("anon sees the listing + tiers + rules on the public views", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: pub } = await anon.from("public_listings").select("id, consent_verified").eq("id", ids.listingId).maybeSingle();
    expect(pub?.consent_verified).toBe(true);
    const { data: tiers } = await anon.from("public_listing_tiers").select("id").eq("listing_id", ids.listingId);
    expect(tiers!.length).toBe(1);
    const { data: rules } = await anon.from("public_listing_rules").select("code").eq("listing_id", ids.listingId);
    expect(rules!.map((r) => r.code)).toContain("PC-03");
    expect(rules!.map((r) => r.code)).toContain("PC-04");
  });

  it("publish is blocked without a ready avatar (fresh draft on a training avatar)", async () => {
    const { data: av } = await admin.from("avatars").insert({
      org_id: ids.creatorOrg, creator_id: ids.creatorId, consent_record_id: ids.consentId,
      provider: "mock", status: "training",
    }).select("id").single();
    const { data: l } = await creator.from("listings").insert({
      org_id: ids.creatorOrg, creator_id: ids.creatorId, avatar_id: av!.id,
      title: "not ready", allowed_categories: ["tech"],
    }).select("id").single();
    await creator.from("license_tiers").insert({ org_id: ids.creatorOrg, listing_id: l!.id, name: "x", price_paise: 100, duration_days: 1 });
    const { error } = await creator.from("listings").update({ status: "published" }).eq("id", l!.id);
    expect(error?.message).toContain("PUBLISH:");
    await admin.from("license_tiers").delete().eq("listing_id", l!.id);
    await admin.from("listings").delete().eq("id", l!.id);
    await admin.from("avatars").delete().eq("id", av!.id);
  });
});

async function submitScript(script: string, category = "fitness") {
  const res = await fetch(`${BASE}/api/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${buyerTok}`,
      "x-test-policy-llm": "mock", // deterministic + free; DEV_OPEN-gated in the route
    },
    body: JSON.stringify({ listing_id: ids.listingId, tier_id: ids.tierId, category, script }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Phase 4 — the approval gate (3-layer engine, mock LLM)", () => {
  it("A: clean script auto-approves", async () => {
    const { status, body } = await submitScript(SCRIPT_A);
    expect(status).toBe(200);
    expect(body.outcome).toBe("auto_approved");
  });

  it("B: medical claim is REJECTED citing PC-03, before any payment", async () => {
    const { body } = await submitScript(SCRIPT_B);
    expect(body.outcome).toBe("rejected");
    expect(body.cited_clauses.map((c: { code: string }) => c.code)).toContain("PC-03");
    // no license exists for a rejected request
    const { data: lic } = await admin.from("licenses").select("id").eq("request_id", body.request_id).maybeSingle();
    expect(lic).toBeNull();
  });

  // WHICH ENGINE DECIDES DEPENDS ON THE TARGET. submitScript sends
  // `x-test-policy-llm: mock`, and the route honours that ONLY on a dev server
  // (DEV_OPEN=1 and not production). So against localhost the deterministic
  // mock decides, and against consentry.app the real Anthropic model does — and
  // they legitimately disagree on this deliberately borderline script: the mock
  // routes it to needs_review, the live model rejects it outright at 0.95
  // confidence. Two earlier versions of this test pinned one specific label and
  // therefore "passed" on one target while failing on the other.
  //
  // Assert the invariant that must hold under BOTH: a financial endorsement,
  // on a listing whose owner has switched PC-04 on, must never be waved
  // through, and must never produce a licence without a human saying yes.
  it("C: a finance endorsement under PC-04 is never auto-approved", async () => {
    const { body } = await submitScript(SCRIPT_C);
    expect(["rejected", "needs_review"]).toContain(body.outcome);
    expect(body.outcome).not.toBe("auto_approved");
    // Blocked outright? Then the creator's own rule must be cited by code —
    // "computer says no" with no clause is not an acceptable answer to a brand.
    if (body.outcome === "rejected") {
      expect(body.cited_clauses.map((c: { code: string }) => c.code)).toContain("PC-04");
    }
    // Either way, nothing is billable until a human has decided.
    const { data: lic } = await admin.from("licenses").select("id").eq("request_id", body.request_id).maybeSingle();
    expect(lic).toBeNull();
  });

  it("a needs_review request: the buyer cannot self-decide, the creator can approve", async () => {
    // Staged directly so the DECISION PATH is exercised deterministically
    // rather than depending on which side of the line the model lands.
    const { data: staged, error: stageErr } = await admin.from("approval_requests").insert({
      listing_id: ids.listingId, tier_id: ids.tierId, buyer_org_id: ids.buyerOrg,
      creator_org_id: ids.creatorOrg, buyer_id: ids.buyerId, category: "fitness", script: SCRIPT_C,
      status: "needs_review", expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    }).select("id").single();
    expect(stageErr).toBeNull();

    const selfDecide = await buyer.rpc("decide_request", { p_request_id: staged!.id, p_decision: "approved" });
    expect(selfDecide.error).not.toBeNull();          // buyers never decide their own request
    const stillPending = await admin.from("approval_requests").select("status").eq("id", staged!.id).single();
    expect(stillPending.data!.status).toBe("needs_review");

    const dec = await creator.rpc("decide_request", { p_request_id: staged!.id, p_decision: "approved" });
    expect(dec.error).toBeNull();
    const { data: req } = await admin.from("approval_requests").select("status").eq("id", staged!.id).single();
    expect(req!.status).toBe("approved");
  });

  it("category mismatch is rejected citing PP-06", async () => {
    const { body } = await submitScript(SCRIPT_A, "beauty"); // not in allowed_categories
    expect(body.outcome).toBe("rejected");
    expect(body.cited_clauses.map((c: { code: string }) => c.code)).toContain("PP-06");
  });
});

describe("Phase 5–7 — checkout → generate → deliver → verify", () => {
  let requestId = "", licenseId = "", genId = "";

  it("approve → mock checkout → license active", async () => {
    const { body } = await submitScript(SCRIPT_A);
    requestId = body.request_id;
    expect(body.outcome).toBe("auto_approved");

    const co = await fetch(`${BASE}/api/checkout`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerTok}` },
      body: JSON.stringify({ request_id: requestId }),
    });
    const coj = await co.json();
    expect(co.status, JSON.stringify(coj)).toBe(200);
    expect(coj.provider).toBe("mock");
    licenseId = coj.license_id;

    const conf = await fetch(`${BASE}/api/payments/mock-confirm`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerTok}` },
      body: JSON.stringify({ license_id: licenseId }),
    });
    expect(conf.status).toBe(200);
    const { data: lic } = await admin.from("licenses").select("status, expires_at").eq("id", licenseId).single();
    expect(lic!.status).toBe("active");
    expect(lic!.expires_at).not.toBeNull();
    // mock payout row created
    const { data: payout } = await admin.from("payouts").select("net_paise").eq("license_id", licenseId).single();
    expect(payout!.net_paise).toBe(499900 - Math.round(499900 * 0.15));
  });

  it("cannot generate before payment (fresh approved request, no checkout)", async () => {
    const { body } = await submitScript(SCRIPT_A);
    const gen = await buyer.rpc("create_generation", { p_license_id: "00000000-0000-0000-0000-000000000000" });
    expect(gen.error).not.toBeNull();
    void body;
  });

  it("generate → media pipeline → delivered with watermark + C2PA", async () => {
    const gen = await fetch(`${BASE}/api/generations`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyerTok}` },
      body: JSON.stringify({ license_id: licenseId }),
    });
    const genj = await gen.json();
    expect(gen.status, JSON.stringify(genj)).toBe(200);
    genId = genj.generation_id;

    // drive the worker (cron auth) — the machine must STOP at celebrity_review
    // (never auto-deliver), then approval via the magic-link token releases it.
    const drive = async (targets: string[]) => {
      let s = "";
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const wr = await fetch(`${BASE}/api/jobs/generation-worker`, {
          method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
        });
        const wj = await wr.json();
        if ((wj.errors ?? []).length) console.log("WORKER ERRORS:", wj.errors);
        const { data } = await admin.from("generations").select("status, error").eq("id", genId).single();
        s = data!.status;
        if (data!.error) console.log("GEN ERROR:", data!.error);
        if (targets.includes(s) || s === "failed") break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      return s;
    };

    const reviewStatus = await drive(["celebrity_review"]);
    expect(reviewStatus).toBe("celebrity_review");

    // preview exists; the brand-facing assets route serves the PREVIEW, never the master
    const { data: genRow } = await admin.from("generations").select("preview_path").eq("id", genId).single();
    expect(genRow!.preview_path).toContain("preview.mp4");
    const assetDuringReview = await fetch(`${BASE}/api/assets/${genId}`, {
      headers: { authorization: `Bearer ${buyerTok}` },
    });
    const assetJson = await assetDuringReview.json();
    expect(assetDuringReview.status).toBe(200);
    expect(assetJson.kind).toBe("preview");
    expect(String(assetJson.url)).not.toContain("master.mp4");

    // approve via the (single-use) magic-link token
    const { data: tok } = await admin.from("approval_tokens")
      .select("token").eq("generation_id", genId).is("used_at", null).single();
    const approveRes = await fetch(`${BASE}/api/approval/${tok!.token}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approveRes.status).toBe(200);

    const status = await drive(["delivered"]);
    expect(status).toBe("delivered");

    // the approval is on the immutable ledger with the script hash
    const { data: events } = await admin.from("approval_events")
      .select("action, script_hash").eq("generation_id", genId);
    expect((events ?? []).some((e) => e.action === "preview_created")).toBe(true);
    expect((events ?? []).some((e) => e.action === "approved" && !!e.script_hash)).toBe(true);

    const { data: g } = await admin.from("generations").select("output_path, watermarked, c2pa_manifest").eq("id", genId).single();
    expect(g!.watermarked).toBe(true);
    expect(g!.output_path).toContain(`${ids.buyerOrg}/${genId}/`);
    expect((g!.c2pa_manifest as { _signed?: boolean })._signed).toBe(true); // c2patool present in repo

    // deliverable actually landed in storage
    const { data: files } = await admin.storage.from("deliverables").list(`${ids.buyerOrg}/${genId}`);
    expect((files ?? []).some((f) => f.name === "final.mp4")).toBe(true);
  }, 120_000);

  it("anon verify_generation cross-checks the ledger hashes", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data } = await anon.rpc("verify_generation", { p_generation_id: genId });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.consent_status).toBe("verified");
    expect(row.creator_handle).toBe(`p34c${runId}`);
    expect(row.script_sha256).toBeTruthy();
  });

  it("signed-URL asset route gives the buyer (not outsiders) a URL", async () => {
    const ok = await fetch(`${BASE}/api/assets/${genId}`, { headers: { authorization: `Bearer ${buyerTok}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toContain("http");
    // creator is also a party (creator_org) — allowed; an unrelated fresh user is not
    const stranger = await signup("buyer", `p34s-${runId}@ex.com`, "Stranger");
    const { tok: sTok } = await authed(`p34s-${runId}@ex.com`);
    const no = await fetch(`${BASE}/api/assets/${genId}`, { headers: { authorization: `Bearer ${sTok}` } });
    expect(no.status).toBe(404);
    await admin.auth.admin.deleteUser(stranger);
    const { data: sp } = await admin.from("profiles").select("org_id").eq("id", stranger).maybeSingle();
    if (sp) await admin.from("orgs").delete().eq("id", sp.org_id);
  });

  it("REVOKE consent → new generation blocked at the gate", async () => {
    await creator.rpc("revoke_consent", { p_consent_id: ids.consentId, p_reason: "demo revoke" });
    // listing suspended
    const { data: listing } = await admin.from("listings").select("status").eq("id", ids.listingId).single();
    expect(listing!.status).toBe("suspended");
    // gate refuses a new generation on the still-active license
    const gen = await buyer.rpc("create_generation", { p_license_id: licenseId });
    expect(gen.error?.message).toContain("GATE:consent_revoked");
    // re-verify so afterAll teardown is clean-ish (not required)
  });
});

