import { createHmac, timingSafeEqual } from "node:crypto";

// Per-job callback URLs (ARCHITECTURE §5.4). Tavus callbacks are UNSIGNED, so
// trust = (a) unguessable per-job token in the URL + (b) mandatory API
// re-fetch before any DB mutation. Token format: base64url(jobType:entityId).hmac
export type CallbackJobType = "replica" | "video";

function secret(): string {
  const s = process.env.TAVUS_WEBHOOK_TOKEN_SECRET;
  if (!s) throw new Error("TAVUS_WEBHOOK_TOKEN_SECRET missing");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function mintCallbackToken(jobType: CallbackJobType, entityId: string): string {
  const payload = `${jobType}:${entityId}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function callbackUrl(jobType: CallbackJobType, entityId: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/api/webhooks/tavus/${mintCallbackToken(jobType, entityId)}`;
}

export function verifyCallbackToken(
  token: string,
): { jobType: CallbackJobType; entityId: string } | null {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString("utf8");
    const expected = Buffer.from(sign(payload), "hex");
    const got = Buffer.from(sig, "hex");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const [jobType, entityId] = payload.split(":");
    if ((jobType !== "replica" && jobType !== "video") || !entityId) return null;
    return { jobType, entityId };
  } catch {
    return null;
  }
}
