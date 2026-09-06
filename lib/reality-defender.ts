// Reality Defender client (image detection — the free tier supports images;
// video needs a paid plan). We use it to verify the CONSENT footage is a REAL
// HUMAN, not a deepfake used to fake consent — which strengthens the consent
// moat. (We do NOT scan our own generated videos: they're authored synthetics,
// and a deepfake detector would correctly flag them, which is the wrong signal.)
//
// Flow (verified 2026-07-11): POST /api/files/aws-presigned {fileName} → signedUrl
// (the request id is the UUID in the S3 key) → PUT bytes → poll
// GET /api/media/users/{requestId} until analyzed → aggregate score.
const BASE = "https://api.prd.realitydefender.xyz";

export interface RdResult {
  available: boolean;
  verdict: "authentic" | "manipulated" | "uncertain" | "error";
  score: number | null; // manipulation probability 0..1 (lower = more authentic)
  authenticity: number | null; // 1 - score, for display
  detail: string;
  error?: string;
}

function reqIdFromSignedUrl(signedUrl: string): string | null {
  try {
    const path = new URL(signedUrl).pathname; // /org_xxx/<uuid>.jpg
    const m = path.match(/([0-9a-f-]{36})\.[a-z0-9]+$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function detectImage(bytes: Buffer): Promise<RdResult> {
  const key = process.env.REALITY_DEFENDER_API_KEY;
  if (!key) return { available: false, verdict: "error", score: null, authenticity: null, detail: "not configured", error: "no_api_key" };
  try {
    // 1) presign
    const pre = await fetch(`${BASE}/api/files/aws-presigned`, {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({ fileName: "consent-frame.jpg" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!pre.ok) {
      const t = await pre.text();
      const paid = /paid plan|free-tier/i.test(t);
      return { available: false, verdict: "error", score: null, authenticity: null,
        detail: paid ? "Reality Defender free tier: image scans only." : "presign failed", error: `presign_${pre.status}` };
    }
    const signedUrl: string = (await pre.json()).response?.signedUrl;
    const reqId = reqIdFromSignedUrl(signedUrl);
    if (!signedUrl || !reqId) return { available: false, verdict: "error", score: null, authenticity: null, detail: "no signed url", error: "no_signed_url" };

    // 2) upload
    const put = await fetch(signedUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!put.ok) return { available: false, verdict: "error", score: null, authenticity: null, detail: "upload failed", error: `put_${put.status}` };

    // 3) poll for the result
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch(`${BASE}/api/media/users/${reqId}`, {
        headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status?: string; resultsSummary?: { status?: string; metadata?: { finalScore?: number } };
      };
      const status = data.resultsSummary?.status ?? data.status;
      const raw = data.resultsSummary?.metadata?.finalScore;
      if (status && status !== "ANALYZING" && raw != null) {
        // RD finalScore is 0..100 manipulation probability
        const score = raw > 1 ? raw / 100 : raw;
        return {
          available: true,
          verdict: score <= 0.3 ? "authentic" : score >= 0.7 ? "manipulated" : "uncertain",
          score,
          authenticity: 1 - score,
          detail: `Reality Defender analyzed the footage: ${Math.round((1 - score) * 100)}% authentic-human confidence.`,
        };
      }
      if (status === "FAKE" || status === "AUTHENTIC" || status === "MANIPULATED") {
        const authentic = status === "AUTHENTIC";
        return { available: true, verdict: authentic ? "authentic" : "manipulated",
          score: authentic ? 0.05 : 0.95, authenticity: authentic ? 0.95 : 0.05,
          detail: `Reality Defender verdict: ${status}.` };
      }
    }
    return { available: true, verdict: "uncertain", score: null, authenticity: null, detail: "Analysis still processing — check back shortly." };
  } catch (e) {
    return { available: false, verdict: "error", score: null, authenticity: null, detail: "scan failed", error: (e as Error).message.slice(0, 120) };
  }
}
