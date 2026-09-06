/**
 * The "scan a video" endpoint — Act 6 of the demo, and the only place a
 * stranger can check a claim we make. E2E: dev server on TEST_BASE_URL.
 *
 * What matters here is that the three answers stay DISTINCT. The endpoint can
 * identify a file two ways — by the C2PA credentials sealed inside it, or by an
 * exact-bytes fingerprint recorded at delivery — and a fingerprint match must
 * never be dressed up as a verified signature. It also has to say "I don't know
 * this file" without sounding like it broke.
 *
 * Rather than depend on a file in storage, each test signs a fresh video whose
 * verify_url points at a chosen generation. That exercises the real read +
 * ledger cross-check while staying deterministic.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { processDeliverable, type ManifestInput } from "@/lib/media/pipeline";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

function manifestFor(generationId: string): ManifestInput {
  return {
    generationId,
    licenseId: "22222222-2222-4222-8222-222222222222",
    requestId: "33333333-3333-4333-8333-333333333333",
    creatorHandle: "arjun",
    buyerOrgName: "Acme Wellness",
    consentRecordHash: "abc123",
    consentVerifiedAt: "2026-07-22T21:27:23.253Z",
    scriptSha256: "d0d0d0d0",
    licenseExpiresAt: "2026-08-03T00:00:00.000Z",
    verifyUrl: `${BASE}/verify/${generationId}`,
    provider: "mock",
  };
}

async function scan(bytes: Buffer, name = "clip.mp4") {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], name, { type: "video/mp4" }));
  const res = await fetch(`${BASE}/api/inspect`, { method: "POST", body: fd });
  return { status: res.status, body: await res.json() };
}

// A video the ledger has never seen. Deliberately NOT assets/mock-raw.mp4:
// that file is byte-identical to a real (early, broken) delivery, so its
// fingerprint IS in the ledger and the scanner correctly recognises it.
async function unknownClip(): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-test-"));
  try {
    const out = path.join(dir, "unknown.mp4");
    spawnSync(ffmpegStatic as string, [
      "-y", "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let master: Buffer;
let deliveredId: string;
let admin: ReturnType<typeof createClient>;

beforeAll(async () => {
  master = await readFile(path.join(process.cwd(), "assets", "mock-raw.mp4"));
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await admin.from("generations")
    .select("id").eq("status", "delivered")
    .order("delivered_at", { ascending: false }).limit(1)
    .returns<Array<{ id: string }>>().maybeSingle();
  if (!data) throw new Error("no delivered generation in the ledger to test against");
  deliveredId = data.id;
}, 120_000);

describe("/api/inspect", () => {
  it("verifies a signed file and cross-checks it against the live ledger", async () => {
    const res = await processDeliverable(master, manifestFor(deliveredId));
    expect(res.signed, "fixture was not signed; nothing to verify").toBe(true);

    const { body } = await scan(res.bytes);
    expect(body.credentialed).toBe(true);
    expect(body.platform_signed).toBe(true);
    expect(body.method).toBe("content_credentials");
    expect(body.verdict).toBe("verified");
    expect(body.generation_id).toBe(deliveredId);
    // Consent is re-read at scan time — that is what lets a revocation flip the
    // answer for a file that was perfectly valid when it was signed.
    expect(body.ledger.found).toBe(true);
    expect(body.ledger.consent_status).toBeTruthy();
    expect(body.assertion.creator_handle).toBe("arjun");
  }, 120_000);

  it("says a signed file is unknown to the ledger rather than verified", async () => {
    // Someone could sign a file with our test certificate — that alone proves
    // nothing. Verification requires the ledger to actually know the record.
    const stranger = "44444444-4444-4444-8444-444444444444";
    const res = await processDeliverable(master, manifestFor(stranger));
    const { body } = await scan(res.bytes);
    expect(body.credentialed).toBe(true);
    expect(body.verdict).toBe("unknown_to_ledger");
    expect(body.ledger.found).toBe(false);
  }, 120_000);

  it("reports a plain, unknown video as having no credentials, not as an error", async () => {
    const { status, body } = await scan(await unknownClip(), "holiday.mp4");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.credentialed).toBe(false);
    expect(body.verdict).toBeUndefined();
    expect(String(body.detail)).toMatch(/no content credentials/i);
    // Always returned, so a file can be discussed by fingerprint even when we
    // have nothing else to say about it.
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("falls back to the file fingerprint when a delivery carries no credentials", async () => {
    // The fallback exists for files delivered before signing worked, and for
    // any future host where the reader is unavailable. assets/mock-raw.mp4 is
    // byte-identical to one of those early deliveries — an accidental but real
    // fixture. Skip rather than fail if that historical row is ever cleaned up.
    const sha = createHash("sha256").update(master).digest("hex");
    const { data } = await admin.from("generations")
      .select("id").eq("output_sha256", sha)
      .returns<Array<{ id: string }>>().maybeSingle();
    if (!data) return;

    const { body } = await scan(master);
    expect(body.credentialed, "must NOT claim credentials it could not read").toBe(false);
    expect(body.method).toBe("file_hash");
    expect(body.verdict).toBe("ledger_match");
    expect(body.generation_id).toBe(data.id);
    expect(body.ledger.found).toBe(true);
    // The wording has to make the weaker basis obvious to whoever is reading it.
    expect(String(body.detail)).toMatch(/fingerprint/i);
  }, 120_000);

  it("rejects a request with no file", async () => {
    const res = await fetch(`${BASE}/api/inspect`, { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_file");
  });
});
