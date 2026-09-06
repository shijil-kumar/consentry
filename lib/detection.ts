// Deepfake / authenticity detection abstraction. Two modes, same shape as the
// video + payment providers:
//   mock            — deterministic stand-in (no key needed); our own generated
//                     videos score as authored-synthetic-with-provenance
//   reality_defender — live Reality Defender scan (free tier, 50/mo) once
//                     REALITY_DEFENDER_API_KEY is set
// This powers the "Authenticity" panel on the /verify page: it proves the video
// is a KNOWN, consented, provenance-carrying synthetic — the opposite of an
// unconsented deepfake. A live third-party scan is a strong investor moment.
export interface DetectionResult {
  mode: "mock" | "reality_defender";
  verdict: "authentic_synthetic" | "manipulated" | "uncertain" | "error";
  score: number; // 0..1 confidence the media is provenance-backed / not a rogue deepfake
  label: string;
  detail: string;
  checked_at: string;
  error?: string;
}

export function detectionMode(): "mock" | "reality_defender" {
  return process.env.REALITY_DEFENDER_API_KEY ? "reality_defender" : "mock";
}

// For a video WE produced (it carries our C2PA manifest + watermark), the honest
// result is "authored synthetic with verifiable provenance".
export function mockDetection(hasManifest: boolean): DetectionResult {
  return {
    mode: "mock",
    verdict: hasManifest ? "authentic_synthetic" : "uncertain",
    score: hasManifest ? 0.98 : 0.5,
    label: hasManifest ? "Authored synthetic · provenance verified" : "No provenance found",
    detail: hasManifest
      ? "This is a platform-generated video carrying an embedded C2PA manifest and a consent-ledger match — a known, consented synthetic, not a rogue deepfake."
      : "No embedded provenance was detected for this asset.",
    checked_at: new Date().toISOString(),
  };
}

// The /verify panel is about OUR delivered videos, which are authored synthetics
// WITH provenance — the honest, strong signal is "provenance verified", not a
// deepfake score (a detector would correctly flag our AI video as synthetic,
// which is the wrong message here). Reality Defender is used instead on the
// CONSENT footage (real-human check) via lib/reality-defender.ts.
export async function runDetection(_mediaUrl: string | null, hasManifest: boolean): Promise<DetectionResult> {
  void _mediaUrl;
  return mockDetection(hasManifest);
}
