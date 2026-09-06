// Regression: /api/inspect must never vouch for a modified file.
//
// The bug this pins: readManifest returned the manifest BODY without the
// reader's validation verdict, so the route read our licence assertion out of a
// doctored video and answered "verified" — naming the real creator, the real
// licence and the real consent record. A genuine endorsement could have been
// re-cut with new words in the star's mouth and this platform would have
// confirmed it as approved. Found 2026-08-04 by uploading a byte-flipped copy.
//
// E2E: needs a dev server on TEST_BASE_URL and the fixture pair in docs/.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const GENUINE = path.resolve(process.cwd(), "docs/demo-assets/A-genuine-signed.mp4");
const TAMPERED = path.resolve(process.cwd(), "docs/demo-assets/B-tampered-4kb-flipped.mp4");

async function inspect(file: string) {
  const buf = await readFile(file);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), path.basename(file));
  const res = await fetch(`${BASE}/api/inspect`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

let haveFixtures = true;
beforeAll(async () => {
  try { await access(GENUINE); await access(TAMPERED); } catch { haveFixtures = false; }
});

describe("/api/inspect tamper detection", () => {
  it("verifies the genuine delivery", async () => {
    if (!haveFixtures) return;
    const { body } = await inspect(GENUINE);
    expect(body.verdict).toBe("verified");
    expect(body.platform_signed).toBe(true);
  }, 60_000);

  it("REFUSES to verify the same video with 4 KB of pixels flipped", async () => {
    if (!haveFixtures) return;
    const { body } = await inspect(TAMPERED);

    // The only acceptable outcome is an explicit tamper verdict.
    expect(body.verdict).toBe("tampered");
    expect(body.verdict).not.toBe("verified");
    expect(body.validation?.contentAltered).toBe(true);
    expect(body.validation?.failureCodes ?? []).toContain("assertion.bmffHash.mismatch");

    // And it must NOT hand back the licence/consent details, which would let a
    // caller screenshot "creator: @arjun" next to a doctored clip.
    expect(body.assertion).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("consent_record_hash");
  }, 60_000);

  it("says plainly that the file was altered, in words a non-expert can act on", async () => {
    if (!haveFixtures) return;
    const { body } = await inspect(TAMPERED);
    expect(String(body.detail).toLowerCase()).toContain("modified");
    expect(String(body.detail).toLowerCase()).toContain("no longer matches");
  }, 60_000);
});
