/**
 * Phase 2 E2E (dev server on localhost:3000, VIDEO_PROVIDER=mock):
 *  consent → avatar insert → worker submit (provider stamped) → worker
 *  reconcile until READY → consent auto-VERIFIED → webhook endpoint honors
 *  the token+refetch+dedupe contract → org scoping on user-JWT kicks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mintCallbackToken } from "@/lib/webhooks";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const runId = Date.now().toString(36);
const PASSWORD = `Phase2-${runId}-pw!`;
const emails = { a: `p2-a-${runId}@example.com`, b: `p2-b-${runId}@example.com` };

let admin: SupabaseClient;
let creatorA: SupabaseClient;
let tokenA = "";
const ids = {
  userA: "", userB: "", orgA: "", orgB: "",
  consentA: "", consentB: "", avatarA: "", avatarB: "", pathA: "", pathB: "",
};

async function makeCreator(email: string, name: string) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, role: "creator", display_name: name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).user_id as string;
}

async function submitConsent(client: SupabaseClient, bearer: string, orgId: string, tag: string) {
  const ch = await fetch(`${BASE}/api/consent/challenge`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const { challenge } = await ch.json();
  const path = `${orgId}/consent-${tag}.webm`;
  const { error } = await client.storage.from("consent-videos")
    .upload(path, new Blob([`p2-${tag}-`.repeat(2000)], { type: "video/webm" }));
  expect(error).toBeNull();
  const sub = await fetch(`${BASE}/api/consent/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ video_path: path, content_type: "video/webm", challenge }),
  });
  expect(sub.status).toBe(200);
  return { consentId: (await sub.json()).consent_id as string, path };
}

beforeAll(async () => {
  admin = createClient(URL_, SECRET_KEY, { auth: { persistSession: false } });
  ids.userA = await makeCreator(emails.a, "P2 Creator A");
  ids.userB = await makeCreator(emails.b, "P2 Creator B");

  creatorA = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
  const { data: sA } = await creatorA.auth.signInWithPassword({ email: emails.a, password: PASSWORD });
  tokenA = sA.session!.access_token;

  const { data: profs } = await admin.from("profiles")
    .select("id, org_id").in("id", [ids.userA, ids.userB]);
  for (const p of profs ?? []) {
    if (p.id === ids.userA) ids.orgA = p.org_id;
    if (p.id === ids.userB) ids.orgB = p.org_id;
  }

  const a = await submitConsent(creatorA, tokenA, ids.orgA, `a-${runId}`);
  ids.consentA = a.consentId;
  ids.pathA = a.path;

  const creatorB = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
  const { data: sB } = await creatorB.auth.signInWithPassword({ email: emails.b, password: PASSWORD });
  const b = await submitConsent(creatorB, sB.session!.access_token, ids.orgB, `b-${runId}`);
  ids.consentB = b.consentId;
  ids.pathB = b.path;

  // both creators queue an avatar; only A will kick the worker
  const { data: avA, error: eA } = await creatorA.from("avatars")
    .insert({ org_id: ids.orgA, creator_id: ids.userA, consent_record_id: ids.consentA })
    .select("id").single();
  expect(eA).toBeNull();
  ids.avatarA = avA!.id;
  const { data: avB, error: eB } = await creatorB.from("avatars")
    .insert({ org_id: ids.orgB, creator_id: ids.userB, consent_record_id: ids.consentB })
    .select("id").single();
  expect(eB).toBeNull();
  ids.avatarB = avB!.id;
}, 180_000);

afterAll(async () => {
  try {
    await admin.from("webhook_events").delete().like("external_id", `%${ids.avatarA}%`);
    await admin.from("avatars").delete().in("id", [ids.avatarA, ids.avatarB].filter(Boolean));
    await admin.from("consent_records").delete().in("id", [ids.consentA, ids.consentB].filter(Boolean));
    await admin.storage.from("consent-videos").remove([ids.pathA, ids.pathB].filter(Boolean));
    for (const u of [ids.userA, ids.userB]) if (u) await admin.auth.admin.deleteUser(u);
    await admin.from("orgs").delete().in("id", [ids.orgA, ids.orgB].filter(Boolean));
  } catch (e) {
    console.warn("cleanup incomplete:", e);
  }
}, 120_000);

describe("worker: submit → reconcile → ready, with org scoping", () => {
  it("user-JWT kick processes ONLY the caller's org", async () => {
    const res = await fetch(`${BASE}/api/jobs/replica-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.scope).toBe(ids.orgA);
    expect(j.submitted).toBeGreaterThanOrEqual(1);

    const { data: rowA } = await admin.from("avatars")
      .select("provider, provider_replica_id").eq("id", ids.avatarA).single();
    expect(rowA!.provider).toBe("mock");
    expect(rowA!.provider_replica_id).toMatch(/^mock-r-/);

    // B's avatar was NOT touched by A's kick
    const { data: rowB } = await admin.from("avatars")
      .select("provider_replica_id").eq("id", ids.avatarB).single();
    expect(rowB!.provider_replica_id).toBeNull();
  });

  it("unauthenticated worker call is rejected", async () => {
    const res = await fetch(`${BASE}/api/jobs/replica-worker`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("reconcile flips the avatar READY and auto-verifies the consent", async () => {
    let status = "";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await fetch(`${BASE}/api/jobs/replica-worker`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const { data } = await admin.from("avatars").select("status").eq("id", ids.avatarA).single();
      status = data!.status;
      if (status === "ready") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(status).toBe("ready");

    const { data: consent } = await admin.from("consent_records")
      .select("status, verified_at").eq("id", ids.consentA).single();
    expect(consent!.status).toBe("verified");
    expect(consent!.verified_at).not.toBeNull();

    const { data: audit } = await admin.from("audit_log")
      .select("action").eq("target_id", ids.avatarA);
    expect(audit!.some((a) => a.action === "avatar.ready")).toBe(true);
  }, 60_000);
});

describe("webhook endpoint: token + re-fetch + dedupe", () => {
  it("valid token → confirmed via re-fetch; replay → duplicate; junk payload never trusted", async () => {
    const token = mintCallbackToken("replica", ids.avatarA);
    const first = await fetch(`${BASE}/api/webhooks/tavus/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Lying payload: claims error — the re-fetch (mock says ready) must win
      body: JSON.stringify({ replica_id: "forged", status: "error" }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).confirmed).toBe("ready");

    const replay = await fetch(`${BASE}/api/webhooks/tavus/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replica_id: "forged", status: "error" }),
    });
    expect((await replay.json()).duplicate).toBe(true);

    // avatar unharmed by the lying payload
    const { data } = await admin.from("avatars").select("status").eq("id", ids.avatarA).single();
    expect(data!.status).toBe("ready");

    const { data: events } = await admin.from("webhook_events")
      .select("external_id, signature_valid, processed_at")
      .eq("external_id", `replica:${ids.avatarA}:ready`);
    expect(events).toHaveLength(1);
    expect(events![0].signature_valid).toBe(true);
    expect(events![0].processed_at).not.toBeNull();
  });

  it("invalid token → 404 and a signature_valid=false forensic row", async () => {
    const res = await fetch(`${BASE}/api/webhooks/tavus/not-a-real-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anything: true }),
    });
    expect(res.status).toBe(404);
    const { data } = await admin.from("webhook_events")
      .select("id").eq("event_type", "invalid_token").eq("signature_valid", false);
    expect(data!.length).toBeGreaterThanOrEqual(1);
    await admin.from("webhook_events").delete().eq("event_type", "invalid_token");
  });
});
