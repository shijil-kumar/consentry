import { transcriptMatchesChallenge } from "@/lib/consent";

// Speech-to-text verification of the spoken challenge phrase.
//
// FAIL-OPEN BY DESIGN for the ledger (the consent row still records the attempt
// + outcome); the UI surfaces an unverified voice check honestly, and an
// unverified check now lands in the admin review queue rather than vanishing.
//
// WHY A CHAIN, NOT ONE PROVIDER
// ElevenLabs' free tier bills Scribe against the same 10,000-credit pool as
// text-to-speech. One real consent recording costs ~40 credits, so the pool is
// ~250 recordings/month — and when it runs out the check does not degrade, it
// hard-fails with quota_exceeded (this happened in production on 2026-08-04).
// A single provider means one exhausted quota silently disables an identity
// check. So: try each configured provider in order, and record which one
// actually produced the transcript.
export type SttMethod =
  | "elevenlabs_scribe"
  | "groq_whisper"
  | "openai_whisper"
  | "self_hosted_whisper"
  | "none";

export interface VoiceCaptchaResult {
  verified: boolean;
  phrase: string;
  method: SttMethod;
  transcript_excerpt?: string;
  match?: { hits: number; total: number };
  error?: string;
  /** Every provider tried, and what it said — so a reviewer can see the chain. */
  attempts?: Array<{ method: SttMethod; ok: boolean; error?: string }>;
  checked_at: string;
}

interface Attempt {
  method: SttMethod;
  configured: boolean;
  run: (audio: Uint8Array, contentType: string) => Promise<string>;
}

/** Strip the video track before transcribing.
 *
 * A consent recording is a 1080p video: one real clip measured 26.8 MB, of
 * which 141 KB was audio — 194x smaller, extracted in 0.3s. Every STT provider
 * caps upload size (OpenAI at 25 MB), so sending the video wastes bandwidth and
 * can fail outright on a longer take. Mono 16 kHz is what Whisper-family models
 * resample to anyway, so nothing useful is discarded.
 *
 * Returns null if extraction is unavailable — callers fall back to the original
 * bytes rather than failing the whole check.
 */
async function extractAudio(media: Buffer): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { writeFile, readFile, unlink } = await import("node:fs/promises");
    const ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
    if (!ffmpegPath) return null;

    const stamp = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const inPath = join(tmpdir(), `consent-${stamp}.bin`);
    const outPath = join(tmpdir(), `consent-${stamp}.mp3`);
    await writeFile(inPath, media);
    try {
      await promisify(execFile)(ffmpegPath, [
        "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", outPath,
      ], { timeout: 60_000 });
      const bytes = new Uint8Array(await readFile(outPath));
      return { bytes, contentType: "audio/mpeg" };
    } finally {
      await unlink(inPath).catch(() => {});
      await unlink(outPath).catch(() => {});
    }
  } catch {
    return null;
  }
}

function form(audio: Uint8Array, contentType: string, filename: string, fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  // Copy into a plain ArrayBuffer: a Uint8Array can be backed by a
  // SharedArrayBuffer, which BlobPart does not accept.
  f.append("file", new Blob([audio.slice().buffer as ArrayBuffer], { type: contentType }), filename);
  return f;
}

async function postForTranscript(
  url: string, headers: Record<string, string>, body: FormData, label: string,
): Promise<string> {
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${label}_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

function providers(): Attempt[] {
  const el = process.env.ELEVENLABS_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  // Any OpenAI-compatible /v1/audio/transcriptions endpoint: faster-whisper,
  // whisper.cpp's server, LM Studio, or a self-hosted box. Costs nothing per
  // call and has no quota, which is the point.
  const local = process.env.WHISPER_URL;

  return [
    {
      method: "elevenlabs_scribe",
      configured: Boolean(el),
      run: (a, ct) => postForTranscript(
        "https://api.elevenlabs.io/v1/speech-to-text",
        { "xi-api-key": el! },
        form(a, ct, "consent-recording", { model_id: "scribe_v1" }),
        "stt",
      ),
    },
    {
      method: "groq_whisper",
      configured: Boolean(groq),
      run: (a, ct) => postForTranscript(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        { authorization: `Bearer ${groq}` },
        form(a, ct, "consent-recording.mp3", { model: "whisper-large-v3-turbo", response_format: "json" }),
        "groq",
      ),
    },
    {
      method: "openai_whisper",
      configured: Boolean(openai),
      run: (a, ct) => postForTranscript(
        "https://api.openai.com/v1/audio/transcriptions",
        { authorization: `Bearer ${openai}` },
        form(a, ct, "consent-recording.mp3", { model: "whisper-1", response_format: "json" }),
        "openai",
      ),
    },
    {
      method: "self_hosted_whisper",
      configured: Boolean(local),
      run: (a, ct) => postForTranscript(
        `${local!.replace(/\/$/, "")}/v1/audio/transcriptions`,
        process.env.WHISPER_API_KEY ? { authorization: `Bearer ${process.env.WHISPER_API_KEY}` } : {},
        form(a, ct, "consent-recording.mp3", {
          model: process.env.WHISPER_MODEL ?? "whisper-1", response_format: "json",
        }),
        "whisper",
      ),
    },
  ];
}

export async function verifyVoiceCaptcha(
  media: Buffer,
  contentType: string,
  phrase: string,
): Promise<VoiceCaptchaResult> {
  const base: Omit<VoiceCaptchaResult, "verified" | "method"> = {
    phrase,
    checked_at: new Date().toISOString(),
  };

  const configured = providers().filter((p) => p.configured);
  if (configured.length === 0) {
    return { ...base, verified: false, method: "none", error: "no_api_key" };
  }

  const audio = await extractAudio(media);
  const bytes = audio?.bytes ?? new Uint8Array(media);
  const type = audio?.contentType ?? (contentType || "video/webm");

  const attempts: NonNullable<VoiceCaptchaResult["attempts"]> = [];
  for (const p of configured) {
    try {
      const transcript = await p.run(bytes, type);
      const match = transcriptMatchesChallenge(transcript, phrase);
      attempts.push({ method: p.method, ok: true });
      return {
        ...base,
        verified: match.matched,
        method: p.method,
        transcript_excerpt: transcript.slice(0, 400),
        match: { hits: match.hits, total: match.total },
        attempts,
      };
    } catch (e) {
      // Quota, outage, bad key — try the next provider rather than declaring
      // the creator unverified because of OUR billing.
      attempts.push({ method: p.method, ok: false, error: (e as Error).message.slice(0, 200) });
    }
  }

  return {
    ...base,
    verified: false,
    method: configured[0].method,
    error: attempts.map((a) => `${a.method}: ${a.error}`).join(" | ").slice(0, 400),
    attempts,
  };
}
