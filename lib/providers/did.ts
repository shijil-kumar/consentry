import type {
  CreateReplicaInput, GenerateVideoInput, NormalizedCallback,
  ReplicaStatus, VideoGenProvider, VideoStatus,
} from "./types";

// D-ID adapter (fallback engine). Verified 2026-07-10 (docs.d-id.com):
//   auth   Authorization: Basic base64("<email>:<api-key>")
//   NO training step — Talks render per-request from a source image.
//   A "reusable actor" = a hosted source image URL reused on every request.
//   talks  POST /talks { source_url, script:{type:text,input,provider}, webhook } → { id, status }
//   poll   GET /talks/{id} → created|started|done|error, result_url (set when done)
// D-ID's terms are NOT the blanket HeyGen service-bureau ban, but re-confirm the
// current terms before white-labeling. Wiring/live-testing happens at go-live
// (needs a paid D-ID key); the shapes below are real so the flip is small.
const API = "https://api.d-id.com";

function authHeader(): string {
  const key = process.env.DID_API_KEY;
  if (!key) throw new Error("DID_API_KEY missing");
  // Accept either a raw "email:key" (we base64 it) or a pre-encoded token.
  const token = key.includes(":") ? Buffer.from(key).toString("base64") : key;
  return `Basic ${token}`;
}

async function did<T>(op: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: authHeader(), ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`did:${op} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export class DidProvider implements VideoGenProvider {
  readonly name = "did" as const;

  // D-ID has no training. The consent recording's still frame is the reusable
  // "actor". ⚠️ GO-LIVE TODO (two parts, both required before VIDEO_PROVIDER=did):
  //   1. D-ID needs an IMAGE, not a video — extract a frame from the consent
  //      recording first.
  //   2. Store a DURABLE hosted URL (or a D-ID actor id) as providerReplicaId —
  //      NEVER the short-lived presigned training URL passed here, which expires
  //      in ~1h and would make every later generation fail with an expired
  //      source_url. Upload the frame to a public/durable asset and store THAT.
  async createReplica(input: CreateReplicaInput) {
    return { providerReplicaId: input.trainVideoUrl };
  }

  async generateVideo(input: GenerateVideoInput) {
    const d = await did<{ id?: string }>("talks", "/talks", {
      method: "POST",
      body: JSON.stringify({
        source_url: input.providerReplicaId, // hosted image/source URL
        script: {
          type: "text",
          input: input.script,
          provider: { type: "microsoft", voice_id: process.env.DID_VOICE_ID ?? "en-US-JennyNeural" },
        },
        config: { stitch: true },
        webhook: input.callbackUrl,
        name: input.videoName,
      }),
    });
    if (!d.id) throw new Error("did:talks no id");
    return { providerVideoId: d.id };
  }

  // No training resource to poll — a source URL is "ready" as soon as it exists.
  async getReplica(providerReplicaId: string): Promise<ReplicaStatus> {
    return providerReplicaId ? { state: "ready", previewVideoUrl: null } : { state: "error", error: "no source" };
  }

  async getVideo(providerVideoId: string): Promise<VideoStatus> {
    const d = await did<{ status?: string; result_url?: string; error?: unknown }>(
      "getVideo", `/talks/${encodeURIComponent(providerVideoId)}`);
    const s = (d.status ?? "").toLowerCase();
    if (s === "done") return { state: "ready", downloadUrl: d.result_url ?? null, hostedUrl: d.result_url ?? null };
    if (s === "error" || s === "rejected") return { state: "error", error: JSON.stringify(d.error ?? s).slice(0, 200) };
    return { state: s === "created" ? "queued" : "generating" };
  }

  parseCallback(body: unknown): NormalizedCallback {
    const b = body as Record<string, unknown> | null;
    const id = (b?.id as string) ?? null;
    return { kind: id ? "video" : "unknown", providerId: id, rawStatus: (b?.status as string) ?? null };
  }
}
