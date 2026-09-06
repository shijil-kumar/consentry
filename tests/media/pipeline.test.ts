/**
 * Media pipeline guarantees — the three claims the product makes about every
 * file it hands over, and the honesty rules around them.
 *
 * These exist because all three broke SILENTLY in production while every local
 * run and every screen looked perfect (2026-07-28/29):
 *   · the visible AI label vanished  — ffmpeg-static's Linux build has no
 *     `drawtext` filter, so the burn-in aborted and the delivery went out bare
 *   · C2PA signing never ran         — the c2patool CLI links GLIBC_2.39 and
 *     the serverless runtime provides 2.34
 *   · the un-approved clean master   — was published as the "watermarked
 *     preview" whenever the transcode failed
 *
 * No unit test could have caught the first two (they are host-specific), which
 * is why /api/health exercises the real code path. What these tests CAN lock
 * down is everything else: that the pipeline reports truthfully what it did,
 * that it never substitutes the master, and that a signed file really carries a
 * readable licence assertion. Run them and the honesty contract holds.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  makePreview, processDeliverable, readManifest, probeMedia, buildManifest,
  type ManifestInput,
} from "@/lib/media/pipeline";

const MANIFEST: ManifestInput = {
  generationId: "11111111-1111-4111-8111-111111111111",
  licenseId: "22222222-2222-4222-8222-222222222222",
  requestId: "33333333-3333-4333-8333-333333333333",
  creatorHandle: "arjun",
  buyerOrgName: "Acme Wellness",
  consentRecordHash: "abc123",
  consentVerifiedAt: "2026-07-22T21:27:23.253Z",
  scriptSha256: "d0d0d0d0",
  licenseExpiresAt: "2026-08-03T00:00:00.000Z",
  verifyUrl: "https://consentry.app/verify/11111111-1111-4111-8111-111111111111",
  provider: "mock",
};

let master: Buffer;

beforeAll(async () => {
  master = await readFile(path.join(process.cwd(), "assets", "mock-raw.mp4"));
});

describe("toolchain probe", () => {
  it("reports every media capability working on this host", async () => {
    const p = await probeMedia() as Record<string, unknown>;
    // Each of these is a real capability check, not a file-existence check.
    // If one is false here it is also false in production — same code path.
    expect(p.ffmpeg, "ffmpeg binary not resolvable").toBe(true);
    expect(p.label_images, "burn-in label PNGs missing from assets/").toBe(true);
    expect(p.label_burn_in, `label burn-in failed: ${p.label_burn_in_error}`).toBe(true);
    expect(p.c2pa_library, "C2PA native binding failed to load").toBe(true);
    expect(p.c2pa_certificate, "no signing certificate configured").toBe(true);
    expect(p.c2pa_sign_and_read, `C2PA sign/read failed: ${p.c2pa_error}`).toBe(true);
  });
});

describe("preview", () => {
  it("never returns the clean master", async () => {
    // The whole product promise is that the brand cannot have the clean file
    // before approval. A previous version fell back to `?? rawBytes`, which
    // published the master as the preview whenever the transcode failed.
    const preview = await makePreview(master);
    expect(preview).not.toBeNull();
    expect(preview!.equals(master)).toBe(false);
  });

  it("is materially smaller than the master (it is a 480p proxy)", async () => {
    const preview = await makePreview(master);
    expect(preview!.length).toBeLessThan(master.length);
  });
});

describe("deliverable", () => {
  it("burns in the visible AI label and seals Content Credentials", async () => {
    const res = await processDeliverable(master, MANIFEST);
    expect(res.notes, `pipeline degraded: ${res.notes.join(" | ")}`).toEqual([]);
    expect(res.watermarked).toBe(true);
    expect(res.signed).toBe(true);
    expect(res.bytes.equals(master)).toBe(false);
  });

  it("reports truthfully — the manifest flags match what actually happened", async () => {
    // The DB column and the public /verify page read these. A flag that cannot
    // say "no" is worse than no flag: production once recorded watermarked=true
    // on a file with no watermark.
    const res = await processDeliverable(master, MANIFEST);
    expect(res.manifestSummary._watermarked).toBe(res.watermarked);
    expect(res.manifestSummary._signed).toBe(res.signed);
    expect(res.manifestSummary._signer).toBe(
      res.signed ? "c2pa-test-cert (pilot, not a production CA)" : "none",
    );
  });

  it("fingerprints the exact bytes it hands over", async () => {
    // /api/inspect identifies a file by this hash, so it must be the hash of
    // the DELIVERED bytes — not of the source, not of the watermarked-but-
    // unsigned intermediate.
    const res = await processDeliverable(master, MANIFEST);
    const actual = createHash("sha256").update(res.bytes).digest("hex");
    expect(res.manifestSummary._sha256).toBe(actual);
  });
});

describe("credentials round-trip", () => {
  it("reads back the licence assertion from the signed file", async () => {
    const res = await processDeliverable(master, MANIFEST);
    const read = await readManifest(res.bytes);
    expect(read.ok, `could not read back: ${read.error}`).toBe(true);

    const store = read.manifest as {
      active_manifest: string;
      manifests: Record<string, {
        assertions: Array<{ label: string; data: Record<string, unknown> }>;
        signature_info?: { issuer?: string };
      }>;
    };
    const active = store.manifests[store.active_manifest];
    const lic = active.assertions.find((a) => a.label === "com.consentfirst.license");

    expect(lic, "our licence assertion is missing from the manifest").toBeTruthy();
    expect(lic!.data.creator_handle).toBe("arjun");
    expect(lic!.data.buyer_org_name).toBe("Acme Wellness");
    expect(lic!.data.script_sha256).toBe("d0d0d0d0");
    // /api/inspect parses the generation id out of this URL to hit the ledger.
    expect(String(lic!.data.verify_url)).toContain(MANIFEST.generationId);
    expect(active.signature_info?.issuer).toBeTruthy();
  });

  it("declares the video AI-generated in machine-readable form", async () => {
    // The IT-Rules disclosure travels two ways: the burned-in badge for humans
    // and this IPTC digital-source-type for platforms that read credentials.
    const m = buildManifest(MANIFEST);
    const actions = m.assertions.find((a) => a.label === "c2pa.actions.v2");
    expect(JSON.stringify(actions)).toContain("trainedAlgorithmicMedia");
  });

  it("answers 'no credentials' for an unsigned file instead of erroring", async () => {
    // A plain video is a normal thing to drop on the scanner. The caller must
    // be able to tell "this file has none" apart from "the reader is broken" —
    // they produce very different messages to the person scanning.
    const read = await readManifest(master);
    expect(read.ok).toBe(false);
    expect(read.error).toBe("no_manifest");
  });
});
