import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Resolve the real ffmpeg binary. Next.js/turbopack rewrites ffmpeg-static's
// exported path to a "\ROOT\…" placeholder that doesn't exist at runtime, so
// prefer an explicit path off process.cwd() (matches how we resolve c2patool).
function resolveFfmpeg(): string | null {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    typeof ffmpegStatic === "string" ? ffmpegStatic : null,
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}
const ffmpegPath = resolveFfmpeg();

// The burn-in labels are PRE-RENDERED PNGs composited with `overlay`, never
// drawn at runtime with `drawtext`.
//
// ffmpeg-static's Linux build has no libfreetype, so drawtext does not exist
// there at all — production answered "Filter not found" and shipped every video
// with no visible AI label, while Windows ffmpeg (which has drawtext) made local
// runs look perfect. No font file could have fixed that. `scale` and `overlay`
// are in every build, so this path works on any host.
// Regenerate the PNGs with `node scripts/make-labels.mjs` after a name change —
// the platform name is baked into the image.
const LABEL_AI = path.join(process.cwd(), "assets", "label-ai.png");
const LABEL_PREVIEW = path.join(process.cwd(), "assets", "label-preview.png");

// Source dimensions, parsed from ffmpeg's own stderr (ffprobe is not shipped
// with ffmpeg-static). Needed because the label is scaled as a fraction of the
// frame — a fixed pixel size would be a speck on 4K and a billboard on 480p.
async function videoSize(file: string): Promise<{ w: number; h: number } | null> {
  if (!ffmpegPath) return null;
  const r = await run(ffmpegPath, ["-hide_banner", "-i", file]); // exits 1: no output file
  const m = r.stderr.match(/Stream #\d+:\d+.*?,\s(\d{2,5})x(\d{2,5})[\s,]/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

// Media pipeline (POLICY_AND_CONSENT_SPEC §5, ARCHITECTURE §7.4):
//   raw mp4 → ① ffmpeg composites the visible "AI · <platform>" corner badge
//           → ② C2PA sign (embed the manifest with our licence assertion)
//           → ③ sha256 the exact delivered bytes for the ledger
// Signing MUST be last — any later edit breaks the content-hash binding.
// Every step is capability-detected and reports what it actually did in
// `notes` + the _watermarked/_signed flags. Nothing here may claim success it
// did not achieve: those flags drive the public /verify and /inspect answers.

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Consent First";

// C2PA signing/reading runs through the @contentauth/c2pa-node LIBRARY, not the
// c2patool CLI. The CLI cannot run on a serverless host: every published Linux
// build links GLIBC_2.39 and the runtime provides 2.34, so signing failed there
// on every delivery. The Node binding is built against GLIBC_2.34 exactly, so it
// runs on the same host the CLI could not.
//
// The certificate is the PUBLIC C2PA test signing cert shipped with the c2pa
// samples — deliberately not a secret and not a production CA, which is why the
// verify page labels the signer as a pilot certificate. Override both with
// C2PA_CERT_PEM / C2PA_KEY_PEM to sign against a real CA.
const CERT_PATH = path.join(process.cwd(), "assets", "c2pa", "es256_certs.pem");
const KEY_PATH = path.join(process.cwd(), "assets", "c2pa", "es256_private.key");

function signingMaterial(): { cert: Buffer; key: Buffer } | null {
  const envCert = process.env.C2PA_CERT_PEM, envKey = process.env.C2PA_KEY_PEM;
  if (envCert && envKey) return { cert: Buffer.from(envCert), key: Buffer.from(envKey) };
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    return { cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) };
  }
  return null;
}

// Loaded lazily: it is a ~50 MB native module, and the routes that never sign or
// read (most of them) should not pay for it at cold start.
type C2paLib = typeof import("@contentauth/c2pa-node");
let c2paPromise: Promise<C2paLib | null> | null = null;
function loadC2pa(): Promise<C2paLib | null> {
  c2paPromise ??= import("@contentauth/c2pa-node").catch(() => null);
  return c2paPromise;
}

export interface ManifestInput {
  generationId: string;
  licenseId: string;
  requestId: string;
  creatorHandle: string | null;
  buyerOrgName: string;
  consentRecordHash: string;
  consentVerifiedAt: string | null;
  scriptSha256: string;
  licenseExpiresAt: string | null;
  verifyUrl: string;
  provider: string;
  /** How the pixels were produced. See generations.render_mode. */
  renderMode?: "live" | "replay";
}

export interface PipelineResult {
  bytes: Buffer;
  watermarked: boolean;
  signed: boolean;
  manifestSummary: Record<string, unknown>;
  notes: string[];
}

function run(cmd: string, args: string[], opts: { input?: Buffer; cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (opts.input) { child.stdin.write(opts.input); child.stdin.end(); }
  });
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// 480p watermarked PREVIEW for the celebrity-approval stage. The clean master
// never leaves private storage until the celebrity approves; this transcode is
// what the brand and the celebrity both see meanwhile.
export async function makePreview(masterBytes: Buffer): Promise<Buffer | null> {
  if (!ffmpegPath) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "cf-prev-"));
  const inPath = path.join(dir, "in.mp4");
  const outPath = path.join(dir, "preview.mp4");
  try {
    await writeFile(inPath, masterBytes);
    // Cap the LONG side at 854 — a fixed `scale=854:-2` UPSCALED vertical
    // footage to 854x1518, bigger than the master. (Seen live on 720x1280.)
    const src = await videoSize(inPath);
    const long = 854;
    let ow: number, oh: number;
    if (src && src.w && src.h) {
      const f = src.w > src.h ? long / src.w : long / src.h;
      ow = Math.max(2, Math.round((src.w * f) / 2) * 2);
      oh = Math.max(2, Math.round((src.h * f) / 2) * 2);
    } else {
      ow = long; oh = Math.round((long * 9) / 16 / 2) * 2;
    }
    const plate = Math.max(24, Math.round(ow / 20)); // banner height, ~5% of width
    const withLabel = [
      "-y", "-i", inPath, "-i", LABEL_PREVIEW,
      "-filter_complex",
      `[0:v]scale=${ow}:${oh}[v];[1:v]scale=-2:${plate}[wm];[v][wm]overlay=(W-w)/2:H-h-16`,
      "-c:v", "libx264", "-crf", "30", "-preset", "fast",
      "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outPath,
    ];
    // Last-ditch mark if the label PNG is missing from the bundle: a plain bar.
    // Poorer, but it still brands the frame as a preview — which matters because
    // the only other option is handing over the clean master, and the caller now
    // refuses to do that. Never remove without keeping that refusal.
    const barOnly = [
      "-y", "-i", inPath,
      "-vf", `scale=${ow}:${oh},drawbox=x=0:y=ih-40:w=iw:h=40:color=black@0.55:t=fill`,
      "-c:v", "libx264", "-crf", "30", "-preset", "fast",
      "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outPath,
    ];

    let r = existsSync(LABEL_PREVIEW) ? await run(ffmpegPath, withLabel) : { code: -1 } as { code: number };
    if (r.code !== 0 || !(await exists(outPath))) r = await run(ffmpegPath, barOnly);
    if (r.code !== 0 || !(await exists(outPath))) return null;
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Extract a single JPEG frame from a video (for image-based authenticity scans).
export async function extractFrame(videoBytes: Buffer, atSeconds = 1): Promise<Buffer | null> {
  if (!ffmpegPath) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "cf-frame-"));
  const inPath = path.join(dir, "in.mp4");
  const outPath = path.join(dir, "frame.jpg");
  try {
    await writeFile(inPath, videoBytes);
    const r = await run(ffmpegPath, ["-y", "-ss", String(atSeconds), "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath]);
    if (r.code !== 0 || !(await exists(outPath))) return null;
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildManifest(m: ManifestInput) {
  return {
    claim_generator_info: [{ name: PLATFORM, version: "0.1.0" }],
    title: `Licensed AI endorsement — ${m.creatorHandle ?? "creator"} × ${m.buyerOrgName}`,
    assertions: [
      {
        label: "c2pa.actions.v2",
        data: {
          actions: [{
            action: "c2pa.created",
            digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
            // Sealed into the file, so the claim travels with the video and
            // cannot be dropped by re-hosting or a screenshot of the UI.
            softwareAgent: {
              name: m.renderMode === "replay"
                ? `${m.provider} (replayed sample) via ${PLATFORM}`
                : `${m.provider} via ${PLATFORM}`,
            },
          }],
        },
      },
      {
        label: "com.consentfirst.license",
        data: {
          license_id: m.licenseId,
          request_id: m.requestId,
          creator_handle: m.creatorHandle,
          buyer_org_name: m.buyerOrgName,
          consent_record_hash: m.consentRecordHash,
          consent_verified_at: m.consentVerifiedAt,
          script_sha256: m.scriptSha256,
          license_expires_at: m.licenseExpiresAt,
          verify_url: m.verifyUrl,
          // Honest by construction: a replayed render says so inside its own
          // Content Credentials, not merely in a UI badge someone could crop.
          render_mode: m.renderMode ?? "live",
          ...(m.renderMode === "replay"
            ? { render_note: "Engine subscription unavailable: this engine's previously-rendered output stood in for the provider call. Consent, licence, approval, watermark, signature and hashing are all real." }
            : {}),
        },
      },
    ],
  };
}

export async function processDeliverable(rawMp4: Buffer, manifest: ManifestInput): Promise<PipelineResult> {
  const notes: string[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), "cf-media-"));
  const rawPath = path.join(dir, "raw.mp4");
  const wmPath = path.join(dir, "wm.mp4");
  const signedPath = path.join(dir, "signed.mp4");
  const manifestJson = buildManifest(manifest);

  try {
    await writeFile(rawPath, rawMp4);

    // ① Disclosure label burn (all frames). Deliberately a compact, broadcast-
    // style corner bug — bottom-right, ~3% frame height, translucent plate —
    // NOT a big banner: the IT Rules require the synthetic-media label to be
    // clearly noticeable, not to dominate the creative, and ad platforms
    // tolerate corner bugs (channel logos, sponsor tags) fine. Machine-readable
    // disclosure additionally travels in the C2PA manifest + platform-level
    // "AI-generated" flags (Meta/YouTube) that brands toggle when boosting.
    let watermarked = false;
    if (ffmpegPath && existsSync(LABEL_AI)) {
      const src = await videoSize(rawPath);
      const plate = Math.max(24, Math.round((src?.h ?? 720) / 18));
      const ff = await run(ffmpegPath, [
        "-y", "-i", rawPath, "-i", LABEL_AI,
        "-filter_complex", `[1:v]scale=-2:${plate}[wm];[0:v][wm]overlay=W-w-20:H-h-20`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
        wmPath,
      ]);
      if (ff.code === 0 && (await exists(wmPath))) {
        watermarked = true;
      } else {
        // Record the REASON, not just the code. A bare exit code cost a full
        // production round-trip to diagnose the missing drawtext filter.
        notes.push(
          `ffmpeg failed (code ${ff.code}); delivering un-watermarked source. ` +
          ff.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300),
        );
      }
    } else {
      notes.push(ffmpegPath
        ? "label image missing from the bundle; watermark skipped"
        : "ffmpeg-static unavailable; watermark skipped");
    }
    const wmSource = watermarked ? wmPath : rawPath;

    // ② C2PA sign — embed the manifest into the file itself.
    let signed = false;
    const c2pa = await loadC2pa();
    const material = signingMaterial();
    if (c2pa && material) {
      try {
        const signer = c2pa.LocalSigner.newSigner(material.cert, material.key, "es256");
        c2pa.Builder.withJson(manifestJson as never).sign(
          signer,
          { path: wmSource, mimeType: "video/mp4" },
          { path: signedPath, mimeType: "video/mp4" },
        );
        signed = await exists(signedPath);
        if (!signed) notes.push("c2pa sign produced no output; manifest stored as sidecar (unsigned)");
      } catch (e) {
        notes.push(`c2pa sign failed: ${(e as Error).message.slice(0, 220)}`);
      }
    } else {
      notes.push(c2pa
        ? "c2pa signing certificate not configured; manifest stored as sidecar (unsigned)"
        : "c2pa library unavailable; manifest stored as sidecar (unsigned)");
    }

    const finalPath = signed ? signedPath : wmSource;
    const bytes = await readFile(finalPath);

    // Fingerprint the exact bytes we hand over. This is the identification path
    // that survives runtimes where the C2PA reader cannot run (Vercel's glibc is
    // older than any published c2patool build): an exact-hash ledger hit proves
    // "we made this file, under this licence" without needing to parse the
    // embedded manifest. Weaker than a signature check — it says nothing about
    // a re-encoded copy — so callers must label the two verdicts differently.
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    return {
      bytes,
      watermarked,
      signed,
      manifestSummary: {
        ...manifestJson,
        _signed: signed,
        _watermarked: watermarked,
        _signer: signed ? "c2pa-test-cert (pilot, not a production CA)" : "none",
        _sha256: sha256,
      },
      notes,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Demo-day preflight: does the media toolchain actually WORK on this host?
// Presence checks are not enough — ffmpeg was present in production and still
// could not burn the label in, because that build lacks the drawtext filter.
// So this composites a real frame through the SAME filter chain the pipeline
// uses. If this says true, the visible AI label genuinely works here.
export async function probeMedia() {
  const out: Record<string, unknown> = {
    ffmpeg: Boolean(ffmpegPath),
    label_images: existsSync(LABEL_AI) && existsSync(LABEL_PREVIEW),
    c2pa_certificate: Boolean(signingMaterial()),
  };
  if (ffmpegPath && existsSync(LABEL_AI)) {
    const dir = await mkdtemp(path.join(tmpdir(), "cf-probe-"));
    try {
      const jpg = path.join(dir, "probe.jpg");
      const r = await run(ffmpegPath, [
        "-y", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=1", "-i", LABEL_AI,
        "-filter_complex", "[1:v]scale=-2:40[wm];[0:v][wm]overlay=W-w-20:H-h-20",
        "-frames:v", "1", "-update", "1", jpg,
      ]);
      out.label_burn_in = r.code === 0 && (await exists(jpg));
      if (!out.label_burn_in) {
        out.label_burn_in_error = r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 240);
      }
    } catch (e) {
      out.label_burn_in = false;
      out.label_burn_in_error = (e as Error).message.slice(0, 160);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // Actually SIGN a tiny file and read it back. Loading the module proves
  // nothing — the whole reason the previous signer was replaced is that it
  // loaded fine and then failed at the moment of use, on production only.
  const c2pa = await loadC2pa();
  out.c2pa_library = Boolean(c2pa);
  const material = signingMaterial();
  if (c2pa && material && ffmpegPath) {
    const dir = await mkdtemp(path.join(tmpdir(), "cf-c2pa-"));
    try {
      const src = path.join(dir, "s.mp4"), dst = path.join(dir, "d.mp4");
      await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "1", src]);
      const signer = c2pa.LocalSigner.newSigner(material.cert, material.key, "es256");
      c2pa.Builder.withJson({ claim_generator_info: [{ name: PLATFORM }] } as never)
        .sign(signer, { path: src, mimeType: "video/mp4" }, { path: dst, mimeType: "video/mp4" });
      const back = await c2pa.Reader.fromAsset({ path: dst, mimeType: "video/mp4" });
      out.c2pa_sign_and_read = Boolean(back?.json()?.active_manifest);
    } catch (e) {
      out.c2pa_sign_and_read = false;
      out.c2pa_error = (e as Error).message.slice(0, 220);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return out;
}

// Read a C2PA manifest back out of a signed file (for /inspect and /verify).
// Returns the same ManifestStore shape c2patool printed — { active_manifest,
// manifests: { <label>: { assertions, signature_info } } } — so callers did not
// have to change when the CLI was replaced by the library.
/** Codes that mean THE PIXELS NO LONGER MATCH WHAT WAS SIGNED.
 *
 * Distinct from `signingCredential.untrusted`, which only means "I don't
 * recognise this issuer" — that is expected for our self-signed certificate and
 * says nothing about whether the file was altered. */
const TAMPER_CODES = [
  "assertion.bmffHash.mismatch",
  "assertion.dataHash.mismatch",
  "assertion.boxesHash.mismatch",
  "claimSignature.mismatch",
];

export interface ManifestValidation {
  /** c2pa's own verdict: "Valid" | "Invalid" | "Trusted" | … */
  state: string | null;
  /** True when a hash/signature assertion failed → the bytes were modified. */
  contentAltered: boolean;
  failureCodes: string[];
}

export async function readManifest(mp4: Buffer): Promise<{
  ok: boolean; manifest?: unknown; validation?: ManifestValidation; error?: string;
}> {
  const c2pa = await loadC2pa();
  if (!c2pa) return { ok: false, error: "c2pa_unavailable" };
  try {
    const reader = await c2pa.Reader.fromAsset({ buffer: mp4, mimeType: "video/mp4" });
    // null means the file simply carries no credentials — a real answer, not a
    // failure, and the caller must not treat it as "scanner unavailable".
    if (!reader) return { ok: false, error: "no_manifest" };
    const manifest = reader.json() as {
      validation_state?: string;
      validation_results?: { activeManifest?: { failure?: Array<{ code?: string }> } };
    };

    // The reader ALREADY knows whether the file matches its signature — it
    // reports assertion.bmffHash.mismatch on a modified file. Returning only
    // the manifest body threw that away, so /api/inspect happily read the
    // licence assertion out of a doctored video and called it "verified".
    // Anyone could have re-cut a real endorsement and had us vouch for it.
    const failureCodes = (manifest.validation_results?.activeManifest?.failure ?? [])
      .map((f) => f.code ?? "").filter(Boolean);
    const validation: ManifestValidation = {
      state: manifest.validation_state ?? null,
      contentAltered: failureCodes.some((c) => TAMPER_CODES.includes(c)),
      failureCodes,
    };
    return { ok: true, manifest, validation };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}
