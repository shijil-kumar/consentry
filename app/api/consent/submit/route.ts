import { createHash } from "node:crypto";
import { z } from "zod";
import { supabaseForRequest } from "@/lib/supabase/server";
import { verifyChallengeSignature, CONSENT_SCRIPT_VERSION, CONSENT_SCOPE_V1 } from "@/lib/consent";
import { verifyVoiceCaptcha } from "@/lib/voice-captcha";
import { probeDurationSeconds } from "@/lib/media/duration";

export const maxDuration = 300; // fluid compute: STT on a ~60s recording

// Floor for an acceptable take: 80% of the 65s the recorder asks for. Below
// this the script cannot have been read in full. Deliberately a floor rather
// than an exact match — encoders round, and a creator who pauses briefly should
// not be rejected.
const MIN_CONSENT_SECONDS = 52;

// B1.3 — server-side hashing + ledger row. Uses ONLY the caller's JWT-bound
// client: the storage download is itself an RLS check (only the owner org can
// read its consent-videos folder), and submit_consent() re-checks creator role.
const Body = z.object({
  video_path: z.string().min(3).max(500),
  content_type: z.string().max(100).optional(),
  challenge: z.object({
    phrase: z.string().min(3).max(100),
    issuedAt: z.number(),
    sig: z.string().length(64),
  }),
  client_duration_s: z.number().min(0).max(3600).optional(),
});

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  // Anti-replay: challenge must be one WE signed for THIS user, recently.
  if (!verifyChallengeSignature(user.id, body.challenge)) {
    return Response.json({ error: "challenge_invalid_or_expired" }, { status: 400 });
  }

  // Download under the caller's own RLS rights — proves ownership of the path.
  const { data: file, error: dlErr } = await supabase.storage
    .from("consent-videos")
    .download(body.video_path);
  if (dlErr || !file) {
    return Response.json({ error: "video_not_readable", detail: dlErr?.message }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength < 10_000) {
    return Response.json({ error: "video_too_small" }, { status: 400 });
  }

  // Duration, measured — not taken from the client. A recording that is
  // materially shorter than the script cannot contain the whole spoken grant,
  // so accepting it would put an incomplete consent on the record. This is a
  // real defect that shipped: a countdown bug cut the still half to ~1s and a
  // 36-second take was stored as a valid consent.
  const measured = await probeDurationSeconds(buf);
  if (measured !== null && measured < MIN_CONSENT_SECONDS) {
    return Response.json({
      error: "recording_too_short",
      detail:
        `This recording is ${measured.toFixed(0)}s. A consent recording must be at least ` +
        `${MIN_CONSENT_SECONDS}s so it contains the whole script and the still segment. ` +
        `Please record again.`,
      measured_duration_s: Number(measured.toFixed(2)),
    }, { status: 400 });
  }

  // The cryptographic anchor: SHA-256 of the exact bytes in the bucket.
  const contentHash = createHash("sha256").update(buf).digest("hex");

  // Voice-captcha: ElevenLabs Scribe transcription must contain the challenge.
  const voiceCaptcha = await verifyVoiceCaptcha(
    buf,
    body.content_type ?? file.type ?? "video/webm",
    body.challenge.phrase,
  );

  const { data: consentId, error: rpcErr } = await supabase.rpc("submit_consent", {
    p_video_path: body.video_path,
    p_hash: contentHash,
    p_scope: {
      ...CONSENT_SCOPE_V1,
      client_duration_s: body.client_duration_s ?? null,
      // Kept alongside the client's claim so the two can be compared later.
      measured_duration_s: measured,
    },
    p_script_version: CONSENT_SCRIPT_VERSION,
    p_voice_captcha: voiceCaptcha,
  });
  if (rpcErr) {
    return Response.json({ error: rpcErr.message }, { status: 400 });
  }

  return Response.json({
    ok: true,
    consent_id: consentId,
    content_hash: contentHash,
    voice_captcha: { verified: voiceCaptcha.verified, error: voiceCaptcha.error ?? null },
    status: "pending",
  });
}
