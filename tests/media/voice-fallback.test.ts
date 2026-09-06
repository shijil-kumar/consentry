// The whole point of the chain is that ONE exhausted quota must not disable an
// identity check. These tests pin that behaviour, because the failure it guards
// against is invisible: everything keeps returning 200, the creator just quietly
// stops being verified.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

// ffmpeg is not the subject here — stub the extraction so these stay fast and
// hermetic. verifyVoiceCaptcha falls back to raw bytes when it returns null.
vi.mock("ffmpeg-static", () => ({ default: null }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const QUOTA_ERROR = jsonResponse(
  { detail: { code: "quota_exceeded", message: "You have 2 credits remaining, while 40 are required." } },
  401,
);

async function run(phrase = "willow meadow 0 6 8") {
  const { verifyVoiceCaptcha } = await import("@/lib/voice-captcha");
  return verifyVoiceCaptcha(Buffer.from("fake-media-bytes"), "video/mp4", phrase);
}

beforeEach(() => {
  vi.resetModules();
  for (const k of ["ELEVENLABS_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "WHISPER_URL"]) {
    delete process.env[k];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("voice captcha provider chain", () => {
  it("reports no_api_key when nothing is configured, rather than claiming a failed check", async () => {
    const r = await run();
    expect(r.method).toBe("none");
    expect(r.error).toBe("no_api_key");
    expect(r.verified).toBe(false);
  });

  it("falls through to the next provider when the first one is out of quota", async () => {
    process.env.ELEVENLABS_API_KEY = "el-key";
    process.env.GROQ_API_KEY = "groq-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(QUOTA_ERROR)
      .mockResolvedValueOnce(jsonResponse({ text: "willow meadow zero six eight" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await run();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("elevenlabs.io");
    expect(fetchMock.mock.calls[1][0]).toContain("groq.com");
    // The creator is verified by the FALLBACK — the quota outage is invisible
    // to them, which is the entire objective.
    expect(r.method).toBe("groq_whisper");
    expect(r.verified).toBe(true);
    expect(r.attempts?.[0]).toMatchObject({ method: "elevenlabs_scribe", ok: false });
    expect(r.attempts?.[0].error).toContain("quota_exceeded");
  });

  it("keeps going through every configured provider before giving up", async () => {
    process.env.ELEVENLABS_API_KEY = "el";
    process.env.GROQ_API_KEY = "groq";
    process.env.OPENAI_API_KEY = "oai";
    process.env.WHISPER_URL = "http://localhost:8080";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const r = await run();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(r.verified).toBe(false);
    expect(r.attempts?.map((a) => a.method)).toEqual([
      "elevenlabs_scribe", "groq_whisper", "openai_whisper", "self_hosted_whisper",
    ]);
    // The reason must name every provider, so "unverified" is never mistaken
    // for "the creator said the wrong words".
    for (const name of ["elevenlabs_scribe", "groq_whisper", "openai_whisper", "self_hosted_whisper"]) {
      expect(r.error).toContain(name);
    }
  });

  it("uses a self-hosted whisper endpoint with no API key at all", async () => {
    process.env.WHISPER_URL = "http://192.168.1.9:8080/";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "willow meadow 0 6 8" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await run();

    // Trailing slash must not produce a double slash in the path.
    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.9:8080/v1/audio/transcriptions");
    expect(r.method).toBe("self_hosted_whisper");
    expect(r.verified).toBe(true);
  });

  it("still reports a genuine mismatch as unverified, not as an outage", async () => {
    process.env.GROQ_API_KEY = "groq";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ text: "something else entirely" })));

    const r = await run();

    expect(r.verified).toBe(false);
    expect(r.error).toBeUndefined();          // nothing broke…
    expect(r.method).toBe("groq_whisper");     // …a provider did answer
    expect(r.transcript_excerpt).toBe("something else entirely");
  });
});
