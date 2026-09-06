import type {
  CreateReplicaInput, GenerateVideoInput, NormalizedCallback,
  ReplicaStatus, VideoGenProvider, VideoStatus,
} from "./types";

// Tavus adapter. Endpoint shapes verified live on 2026-07-09 with the real key:
//   GET /v2/replicas?replica_type=system → 200 (replica_id, status: "completed",
//   training_progress, thumbnail_video_url…). /v2/faces serves the same data
//   with face_* field names — we standardize on /v2/replicas naming because
//   the video API takes `replica_id`.
// Replica lifecycle: started|completed|error · Video: queued|generating|ready|deleted|error.
// Callbacks are UNSIGNED → callers must re-fetch before trusting anything.
const BASE = "https://tavusapi.com";

class TavusError extends Error {
  constructor(op: string, status: number, detail: string) {
    super(`tavus:${op} ${status}: ${detail.slice(0, 300)}`);
  }
}

async function tavus<T>(op: string, path: string, init?: RequestInit): Promise<T> {
  const key = process.env.TAVUS_API_KEY;
  if (!key) throw new Error("TAVUS_API_KEY missing");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": key,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new TavusError(op, res.status, await res.text());
  return (await res.json()) as T;
}

export class TavusProvider implements VideoGenProvider {
  readonly name = "tavus" as const;

  async createReplica(input: CreateReplicaInput) {
    const data = await tavus<{ replica_id: string }>("createReplica", "/v2/replicas", {
      method: "POST",
      body: JSON.stringify({
        train_video_url: input.trainVideoUrl,
        replica_name: input.name,
        callback_url: input.callbackUrl,
        model_name: "phoenix-4",
      }),
    });
    return { providerReplicaId: data.replica_id };
  }

  async generateVideo(input: GenerateVideoInput) {
    const data = await tavus<{ video_id: string }>("generateVideo", "/v2/videos", {
      method: "POST",
      body: JSON.stringify({
        replica_id: input.providerReplicaId,
        script: input.script,
        video_name: input.videoName,
        callback_url: input.callbackUrl,
        ...(input.fast ? { fast: true } : {}),
      }),
    });
    return { providerVideoId: data.video_id };
  }

  async getReplica(providerReplicaId: string): Promise<ReplicaStatus> {
    const d = await tavus<{
      status?: string; error_message?: string; thumbnail_video_url?: string;
    }>("getReplica", `/v2/replicas/${encodeURIComponent(providerReplicaId)}`);
    const s = (d.status ?? "").toLowerCase();
    if (s === "completed") return { state: "ready", previewVideoUrl: d.thumbnail_video_url ?? null };
    if (s === "error") return { state: "error", error: d.error_message ?? "training failed" };
    return { state: "training" };
  }

  async getVideo(providerVideoId: string): Promise<VideoStatus> {
    const d = await tavus<{
      status?: string; download_url?: string; hosted_url?: string; error_message?: string;
    }>("getVideo", `/v2/videos/${encodeURIComponent(providerVideoId)}`);
    const s = (d.status ?? "").toLowerCase();
    if (s === "ready") {
      return { state: "ready", downloadUrl: d.download_url ?? null, hostedUrl: d.hosted_url ?? null };
    }
    if (s === "error" || s === "deleted") {
      return { state: "error", error: d.error_message ?? `video ${s}` };
    }
    return { state: s === "queued" ? "queued" : "generating" };
  }

  parseCallback(body: unknown): NormalizedCallback {
    const b = body as Record<string, unknown> | null;
    const replicaId = (b?.replica_id as string) ?? null;
    const videoId = (b?.video_id as string) ?? null;
    return {
      kind: replicaId ? "replica" : videoId ? "video" : "unknown",
      providerId: replicaId ?? videoId,
      rawStatus: (b?.status as string) ?? null,
    };
  }
}
