/**
 * B0.4 — RLS negative-test suite (DATA_MODEL §8, all 13 checks + ledger E2E).
 * Runs with the CLIENT SDK (publishable key) against the live project; the
 * service client is used only for fixtures and for checks that prove even it
 * is powerless where it should be (audit immutability).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const runId = Date.now().toString(36);
const PASSWORD = `Rls-test-${runId}-pw!`;
const email = (n: string) => `rls-${n}-${runId}@example.com`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const SCRIPT_OK =
  "I have been trying the new AeroFit smart band for a week and the sleep tracking is genuinely useful for building a morning routine.";
const SCRIPT_AMBIGUOUS =
  "Big news coming for my portfolio this month. I have partnered with WealthNest, the only app I trust with my money.";

let admin: SupabaseClient;
let anon: SupabaseClient;
let creatorA: SupabaseClient;
let creatorB: SupabaseClient;
let buyerC: SupabaseClient;

const ids = {
  userA: "", userB: "", userC: "",
  orgA: "", orgB: "", orgC: "",
  consentA: "", avatarA: "", listingA: "", tierA: "",
  requestC: "", request2C: "", licenseC: "", gen1: "", gen2: "",
  clausePC03: "",
};

async function signedInClient(mail: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: mail, password: PASSWORD });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  admin = createClient(URL, SECRET_KEY, { auth: { persistSession: false } });
  anon = createClient(URL, ANON_KEY, { auth: { persistSession: false } });

  // Three users → trigger creates orgs + profiles
  for (const [name, role, handle] of [
    ["a", "creator", `arjun-test-${runId}`],
    ["b", "creator", null],
    ["c", "buyer", null],
  ] as const) {
    const { data, error } = await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role, display_name: `RLS ${name.toUpperCase()}`, handle },
    });
    if (error) throw error;
    if (name === "a") ids.userA = data.user!.id;
    if (name === "b") ids.userB = data.user!.id;
    if (name === "c") ids.userC = data.user!.id;
  }
  creatorA = await signedInClient(email("a"));
  creatorB = await signedInClient(email("b"));
  buyerC = await signedInClient(email("c"));

  const { data: profs, error: pErr } = await admin
    .from("profiles").select("id, org_id").in("id", [ids.userA, ids.userB, ids.userC]);
  if (pErr) throw pErr;
  for (const p of profs!) {
    if (p.id === ids.userA) ids.orgA = p.org_id;
    if (p.id === ids.userB) ids.orgB = p.org_id;
    if (p.id === ids.userC) ids.orgC = p.org_id;
  }

  // Happy chain: consent → avatar → verified/ready → published listing + tier
  const { data: consentId, error: cErr } = await creatorA.rpc("submit_consent", {
    p_video_path: `${ids.orgA}/consent-${runId}.webm`,
    p_hash: sha256(`fake-video-${runId}`),
    p_scope: { commercial_endorsement: true, territories: ["IN"] },
    p_script_version: "v1",
  });
  if (cErr) throw cErr;
  ids.consentA = consentId as string;

  const { data: av, error: aErr } = await creatorA.from("avatars")
    .insert({ org_id: ids.orgA, creator_id: ids.userA, consent_record_id: ids.consentA, provider: "mock" })
    .select("id").single();
  if (aErr) throw aErr;
  ids.avatarA = av!.id;

  for (const [fn, args] of [
    ["mark_consent_verified", { p_consent_id: ids.consentA }],
    ["mark_avatar_ready", { p_avatar_id: ids.avatarA, p_provider_replica_id: `mock-face-${runId}` }],
  ] as const) {
    const { error } = await admin.rpc(fn, args as never);
    if (error) throw new Error(`${fn}: ${error.message}`);
  }

  const { data: li, error: lErr } = await creatorA.from("listings")
    .insert({
      org_id: ids.orgA, creator_id: ids.userA, avatar_id: ids.avatarA,
      title: `RLS Test Listing ${runId}`, allowed_categories: ["fitness", "tech"],
    }).select("id").single();
  if (lErr) throw lErr;
  ids.listingA = li!.id;

  const { data: tier, error: tErr } = await creatorA.from("license_tiers")
    .insert({
      org_id: ids.orgA, listing_id: ids.listingA, name: "Single Ad",
      price_paise: 499900, duration_days: 7, max_generations: 2,
    }).select("id").single();
  if (tErr) throw tErr;
  ids.tierA = tier!.id;

  const { data: clause } = await creatorA.from("policy_clauses")
    .select("id").eq("code", "PC-03").single();
  ids.clausePC03 = clause!.id;
  const { error: lpuErr } = await creatorA.from("listing_prohibited_uses")
    .insert({ listing_id: ids.listingA, clause_id: ids.clausePC03 });
  if (lpuErr) throw lpuErr;

  const { error: pubErr } = await creatorA.from("listings")
    .update({ status: "published" }).eq("id", ids.listingA);
  if (pubErr) throw pubErr;

  // Buyer request → auto-approved → checkout → activated license
  const { data: req, error: rErr } = await buyerC.from("approval_requests")
    .insert({
      buyer_org_id: ids.orgC, buyer_id: ids.userC, creator_org_id: ids.orgA,
      listing_id: ids.listingA, tier_id: ids.tierA, category: "fitness", script: SCRIPT_OK,
    }).select("id, script_hash").single();
  if (rErr) throw rErr;
  ids.requestC = req!.id;
  expect(req!.script_hash).toBe(sha256(SCRIPT_OK)); // server-computed, not client-supplied

  const { error: vErr } = await admin.rpc("apply_policy_verdict", {
    p_request_id: ids.requestC,
    p_report: { outcome: "auto_approved", engine_version: "test-fixture" },
  });
  if (vErr) throw vErr;

  const { data: lic, error: coErr } = await buyerC.rpc("begin_checkout", { p_request_id: ids.requestC });
  if (coErr) throw coErr;
  ids.licenseC = lic as string;

  const { error: actErr } = await admin.rpc("activate_license", {
    p_license_id: ids.licenseC, p_rzp_payment_id: `pay_test_${runId}`,
  });
  if (actErr) throw actErr;
}, 120_000);

afterAll(async () => {
  // FK-ordered cleanup (audit_log stays — append-only by design)
  try {
    await admin.from("payouts").delete().eq("license_id", ids.licenseC);
    await admin.from("generations").delete().in("license_id", [ids.licenseC]);
    await admin.from("licenses").delete().eq("id", ids.licenseC);
    await admin.from("approval_requests").delete().in("id", [ids.requestC, ids.request2C].filter(Boolean));
    await admin.from("listing_prohibited_uses").delete().eq("listing_id", ids.listingA);
    await admin.from("license_tiers").delete().eq("id", ids.tierA);
    await admin.from("listings").delete().eq("id", ids.listingA);
    await admin.from("avatars").delete().eq("id", ids.avatarA);
    await admin.from("consent_records").delete().eq("id", ids.consentA);
    await admin.storage.from("consent-videos").remove([`${ids.orgA}/upload-${runId}.webm`]);
    for (const u of [ids.userA, ids.userB, ids.userC]) {
      if (u) await admin.auth.admin.deleteUser(u);
    }
    await admin.from("orgs").delete().in("id", [ids.orgA, ids.orgB, ids.orgC].filter(Boolean));
  } catch (e) {
    console.warn("cleanup incomplete:", e);
  }
}, 120_000);

describe("check 1+2 — cross-org and buyer read isolation", () => {
  it("B cannot read A's consent/avatars/licenses/generations/payouts (0 rows, no error)", async () => {
    for (const table of ["consent_records", "avatars", "licenses", "generations", "payouts"]) {
      const { data, error } = await creatorB.from(table).select("id");
      expect(error, table).toBeNull();
      expect(data, table).toHaveLength(0);
    }
  });
  it("A sees own consent row (positive control)", async () => {
    const { data } = await creatorA.from("consent_records").select("id");
    expect(data).toHaveLength(1);
  });
  it("C sees public_listings but zero base consent_records", async () => {
    const { data: pub } = await buyerC.from("public_listings").select("id, consent_verified");
    expect(pub!.length).toBeGreaterThanOrEqual(1);
    expect(pub!.find((l) => l.id === ids.listingA)?.consent_verified).toBe(true);
    const { data: base } = await buyerC.from("consent_records").select("id");
    expect(base).toHaveLength(0);
  });
  it("license_details gives buyer the creator identity (positive control)", async () => {
    const { data } = await buyerC.from("license_details").select("*").eq("license_id", ids.licenseC).single();
    expect(data!.creator_name).toBe("RLS A");
    expect(data!.consent_verified).toBe(true);
    expect(data!.status).toBe("active");
  });
});

describe("check 3+4 — client writes are blocked", () => {
  it("C cannot INSERT into generations/licenses/payouts/audit_log", async () => {
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["generations", { license_id: ids.licenseC, request_id: ids.requestC, buyer_org_id: ids.orgC, creator_org_id: ids.orgA, script: SCRIPT_OK, script_hash: "x" }],
      ["licenses", { request_id: ids.requestC, buyer_org_id: ids.orgC, creator_org_id: ids.orgA, listing_id: ids.listingA, tier_id: ids.tierA, amount_paise: 1 }],
      ["payouts", { org_id: ids.orgC, license_id: ids.licenseC, gross_paise: 1, platform_fee_paise: 0, net_paise: 1 }],
      ["audit_log", { action: "forged", target_table: "x", prev_hash: "0", row_hash: "0" }],
    ];
    for (const [table, row] of attempts) {
      const { error } = await buyerC.from(table).insert(row);
      expect(error, table).not.toBeNull();
    }
  });
  it("C cannot UPDATE approval_requests (status or policy_report)", async () => {
    const { error } = await buyerC.from("approval_requests")
      .update({ status: "auto_approved" }).eq("id", ids.requestC);
    expect(error).not.toBeNull();
  });
});

describe("check 5 — the generation gate (every GATE:* condition)", () => {
  const expectGate = async (client: SupabaseClient, code: string) => {
    const { error } = await client.rpc("create_generation", { p_license_id: ids.licenseC });
    expect(error).not.toBeNull();
    expect(error!.message).toContain(code);
  };

  it("GATE:not_buyer — another org cannot fire the gate", async () => {
    await expectGate(creatorB, "GATE:not_buyer");
  });
  it("GATE:license_not_active — unpaid license generates nothing", async () => {
    await admin.from("licenses").update({ status: "payment_pending" }).eq("id", ids.licenseC);
    await expectGate(buyerC, "GATE:license_not_active");
    await admin.from("licenses").update({ status: "active" }).eq("id", ids.licenseC);
  });
  it("GATE:not_approved — approval is re-checked at generation time", async () => {
    await admin.from("approval_requests").update({ status: "rejected" }).eq("id", ids.requestC);
    await expectGate(buyerC, "GATE:not_approved");
    await admin.from("approval_requests").update({ status: "auto_approved" }).eq("id", ids.requestC);
  });
  it("GATE:script_tampered — script is re-hashed, stored hash not trusted", async () => {
    await admin.from("approval_requests")
      .update({ script: SCRIPT_OK + " …now with sneaky edits." }).eq("id", ids.requestC);
    await expectGate(buyerC, "GATE:script_tampered");
    await admin.from("approval_requests").update({ script: SCRIPT_OK }).eq("id", ids.requestC);
  });
  it("GATE:consent_revoked — revocation kills future generations", async () => {
    await admin.from("consent_records")
      .update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", ids.consentA);
    await expectGate(buyerC, "GATE:consent_revoked");
    await admin.from("consent_records").update({ status: "verified" }).eq("id", ids.consentA);
  });
  it("GATE:avatar_unavailable — disabled avatar blocks", async () => {
    await admin.from("avatars").update({ status: "disabled" }).eq("id", ids.avatarA);
    await expectGate(buyerC, "GATE:avatar_unavailable");
    await admin.from("avatars").update({ status: "ready" }).eq("id", ids.avatarA);
  });
  it("happy path passes the gate, then GATE:quota_exhausted on the 3rd call", async () => {
    const g1 = await buyerC.rpc("create_generation", { p_license_id: ids.licenseC });
    expect(g1.error).toBeNull();
    ids.gen1 = g1.data as string;
    const g2 = await buyerC.rpc("create_generation", { p_license_id: ids.licenseC });
    expect(g2.error).toBeNull();
    ids.gen2 = g2.data as string;
    await expectGate(buyerC, "GATE:quota_exhausted"); // tier max_generations = 2
    const { data: audit } = await buyerC.from("audit_log")
      .select("action").eq("action", "generation.queued");
    expect(audit!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("check 6 — manual decisions are listing-owner-only", () => {
  it("B cannot decide a request on A's listing; A can (and rejection needs a clause)", async () => {
    const { data: req2, error } = await buyerC.from("approval_requests")
      .insert({
        buyer_org_id: ids.orgC, buyer_id: ids.userC, creator_org_id: ids.orgA,
        listing_id: ids.listingA, tier_id: ids.tierA, category: "fitness", script: SCRIPT_AMBIGUOUS,
      }).select("id").single();
    expect(error).toBeNull();
    ids.request2C = req2!.id;
    await admin.rpc("apply_policy_verdict", {
      p_request_id: ids.request2C,
      p_report: { outcome: "needs_review", engine_version: "test-fixture" },
    });

    const asB = await creatorB.rpc("decide_request", { p_request_id: ids.request2C, p_decision: "approved" });
    expect(asB.error).not.toBeNull();
    expect(asB.error!.message).toContain("REQUEST:not_listing_owner");

    const rejectNoClause = await creatorA.rpc("decide_request", { p_request_id: ids.request2C, p_decision: "rejected" });
    expect(rejectNoClause.error!.message).toContain("REQUEST:rejection_requires_clause");

    const asA = await creatorA.rpc("decide_request", { p_request_id: ids.request2C, p_decision: "approved" });
    expect(asA.error).toBeNull();
  });
});

describe("check 7 — anonymous surface is EXACTLY the public views", () => {
  it("anon reads the four public views + policy_clauses", async () => {
    for (const view of ["public_listings", "public_creators", "public_listing_tiers", "public_listing_rules"]) {
      const { data, error } = await anon.from(view).select("*");
      expect(error, view).toBeNull();
      expect(data!.length, view).toBeGreaterThanOrEqual(1);
    }
    const { data: clauses } = await anon.from("policy_clauses").select("code");
    expect(clauses!.length).toBeGreaterThanOrEqual(16);
  });
  it("anon gets zero rows from every base table", async () => {
    for (const table of ["orgs", "profiles", "consent_records", "avatars", "listings",
      "approval_requests", "licenses", "generations", "payouts", "audit_log", "webhook_events"]) {
      const { data, error } = await anon.from(table).select("*").limit(5);
      if (table === "listings") {
        // published listings are deliberately anon-visible on the base table
        expect(error).toBeNull();
        expect(data!.every((l: { status: string }) => l.status === "published")).toBe(true);
      } else {
        expect(error, table).toBeNull();
        expect(data, table).toHaveLength(0);
      }
    }
  });
  it("anon cannot read license_details at all", async () => {
    const { error } = await anon.from("license_details").select("*");
    expect(error).not.toBeNull();
  });
});

describe("check 8 — storage isolation", () => {
  it("A uploads to own consent folder; B cannot download it; C cannot list deliverables", async () => {
    const path = `${ids.orgA}/upload-${runId}.webm`;
    const up = await creatorA.storage.from("consent-videos")
      .upload(path, new Blob([`fake-consent-${runId}`]), { contentType: "video/webm" });
    expect(up.error).toBeNull();

    const asB = await creatorB.storage.from("consent-videos").download(path);
    expect(asB.error).not.toBeNull();

    const list = await buyerC.storage.from("deliverables").list();
    expect(list.data ?? []).toHaveLength(0);
  });
});

describe("check 9 — audit chain is immutable, even for the service role", () => {
  it("service-role UPDATE and DELETE on audit_log both fail", async () => {
    const upd = await admin.from("audit_log").update({ action: "rewritten" }).gt("id", 0);
    expect(upd.error).not.toBeNull();
    const del = await admin.from("audit_log").delete().gt("id", 0);
    expect(del.error).not.toBeNull();
  });
});

describe("check 10 — service-only RPCs are not callable by users", () => {
  it("buyer C gets permission denied on every service RPC", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["apply_policy_verdict", { p_request_id: ids.requestC, p_report: { outcome: "auto_approved" } }],
      ["activate_license", { p_license_id: ids.licenseC, p_rzp_payment_id: "pay_forged" }],
      ["mark_consent_verified", { p_consent_id: ids.consentA }],
      ["mark_avatar_ready", { p_avatar_id: ids.avatarA, p_provider_replica_id: "forged" }],
      ["complete_generation", { p_generation_id: ids.gen1, p_output_path: "x", p_manifest: {} }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await buyerC.rpc(fn, args as never);
      expect(error, fn).not.toBeNull();
      expect(error!.message, fn).toMatch(/permission denied/i);
    }
  });
});

describe("checks 11–13 — org hijack, likeness theft, cross-buyer checkout", () => {
  it("C cannot swap org_id on their own profile", async () => {
    const { error } = await buyerC.from("profiles").update({ org_id: ids.orgA }).eq("id", ids.userC);
    expect(error).not.toBeNull();
  });
  it("B cannot create a listing pointing at A's avatar", async () => {
    const { error } = await creatorB.from("listings").insert({
      org_id: ids.orgB, creator_id: ids.userB, avatar_id: ids.avatarA, title: "stolen likeness",
    });
    expect(error).not.toBeNull();
  });
  it("B cannot begin_checkout on C's request", async () => {
    const { error } = await creatorB.rpc("begin_checkout", { p_request_id: ids.requestC });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("CHECKOUT:not_buyer");
  });
  it("begin_checkout is idempotent for the real buyer while payment is pending", async () => {
    // fixture: request2C is approved with no license yet
    const first = await buyerC.rpc("begin_checkout", { p_request_id: ids.request2C });
    expect(first.error).toBeNull();
    const second = await buyerC.rpc("begin_checkout", { p_request_id: ids.request2C });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    await admin.from("payouts").delete().eq("license_id", first.data as string);
    await admin.from("licenses").delete().eq("id", first.data as string);
  });
});

describe("notifications + reports RLS (new surfaces)", () => {
  it("a notification is visible only to its recipient org", async () => {
    // service inserts a notification for creator A's org
    await admin.from("notifications").insert({
      org_id: ids.orgA, type: "license_earned", title: "Test notif", body: "hi",
    });
    const asA = await creatorA.from("notifications").select("id").eq("org_id", ids.orgA);
    expect((asA.data ?? []).length).toBeGreaterThanOrEqual(1);
    const asB = await creatorB.from("notifications").select("id").eq("org_id", ids.orgA);
    expect(asB.data ?? []).toHaveLength(0);
    // clients cannot insert notifications
    const forged = await buyerC.from("notifications").insert({ org_id: ids.orgC, type: "license_earned", title: "x" });
    expect(forged.error).not.toBeNull();
  });

  it("file_report works for a party; resolve_report is not user-callable", async () => {
    const { data: rid, error } = await buyerC.rpc("file_report", {
      p_generation_id: ids.gen1, p_category: "impersonation", p_detail: "This is not the real person at all.",
    });
    expect(error).toBeNull();
    expect(rid).toBeTruthy();
    // reporter sees own report
    const mine = await buyerC.from("reports").select("id").eq("id", rid as string);
    expect(mine.data).toHaveLength(1);
    // a user cannot call the admin-only resolve RPC
    const resolve = await buyerC.rpc("resolve_report", { p_report_id: rid as string, p_status: "dismissed" });
    expect(resolve.error).not.toBeNull();
    expect(resolve.error!.message).toMatch(/permission denied/i);
    // security-review fix: the ACCUSED creator must NOT be able to read the
    // report (which carries the complainant's email) — only reporter + admin.
    const asCreator = await creatorA.from("reports").select("reporter_email").eq("id", rid as string);
    expect(asCreator.data ?? []).toHaveLength(0);
    await admin.from("reports").delete().eq("id", rid as string);
  });
});

describe("ledger E2E — delivery + public verification", () => {
  it("worker claim → complete_generation → anon verify_generation cross-checks hashes", async () => {
    // simulate the sanctioned worker claim + processing hop
    await admin.from("generations").update({ status: "generating" }).eq("id", ids.gen1);
    await admin.from("generations").update({ status: "processing", raw_output_url: "mock://raw" }).eq("id", ids.gen1);
    const done = await admin.rpc("complete_generation", {
      p_generation_id: ids.gen1,
      p_output_path: `${ids.orgC}/${ids.gen1}/final.mp4`,
      p_manifest: { claim_generator: "test/0.0.1" },
    });
    expect(done.error).toBeNull();

    const { data, error } = await anon.rpc("verify_generation", { p_generation_id: ids.gen1 });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.script_sha256).toBe(sha256(SCRIPT_OK));
    expect(row.consent_record_hash).toBe(sha256(`fake-video-${runId}`));
    expect(row.consent_status).toBe("verified");
    expect(row.creator_handle).toBe(`arjun-test-${runId}`);
  });

  it("a license party CANNOT read raw_output_url (column-level RLS, review fix #1)", async () => {
    // stamp a raw provider URL on the delivered gen as the worker would
    await admin.from("generations").update({ raw_output_url: "https://provider/raw-unwatermarked.mp4" }).eq("id", ids.gen1);
    // buyer is a party → can read allowed columns
    const ok = await buyerC.from("generations").select("id, status, output_path").eq("id", ids.gen1).single();
    expect(ok.error).toBeNull();
    // but selecting the raw column is denied at the column level
    const denied = await buyerC.from("generations").select("raw_output_url").eq("id", ids.gen1);
    expect(denied.error).not.toBeNull(); // permission denied for column raw_output_url
  });
});


