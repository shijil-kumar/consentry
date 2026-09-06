import type {
  CreateReplicaInput, GenerateVideoInput, NormalizedCallback,
  ReplicaStatus, VideoGenProvider, VideoStatus,
} from "./types";

// STATELESS mock: progress is encoded in the id itself (creation timestamp),
// so it behaves identically across serverless invocations and test processes.
// mock-r-<epochMs>-<rand> · mock-v-<epochMs>-<rand>
const TRAINING_MS = Number(process.env.MOCK_TRAINING_MS ?? 6000);
const GENERATION_MS = Number(process.env.MOCK_GENERATION_MS ?? 8000);

function bornAt(id: string): number {
  const m = id.match(/^mock-[rv]-(\d+)-/);
  return m ? Number(m[1]) : 0;
}

export class MockProvider implements VideoGenProvider {
  readonly name = "mock" as const;

  async createReplica(input: CreateReplicaInput) {
    void input; // interface parity with live providers
    return { providerReplicaId: `mock-r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async generateVideo(input: GenerateVideoInput) {
    void input;
    return { providerVideoId: `mock-v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async getReplica(providerReplicaId: string): Promise<ReplicaStatus> {
    const born = bornAt(providerReplicaId);
    if (!born) return { state: "error", error: "mock: unknown replica id" };
    return Date.now() - born >= TRAINING_MS
      ? { state: "ready", previewVideoUrl: null }
      : { state: "training" };
  }

  async getVideo(providerVideoId: string): Promise<VideoStatus> {
    const born = bornAt(providerVideoId);
    if (!born) return { state: "error", error: "mock: unknown video id" };
    const elapsed = Date.now() - born;
    if (elapsed >= GENERATION_MS) {
      // Fixed sample output (wired to real bytes in the media-pipeline phase).
      return { state: "ready", downloadUrl: `mock://sample/${providerVideoId}.mp4`, hostedUrl: null };
    }
    return { state: elapsed < GENERATION_MS / 4 ? "queued" : "generating" };
  }

  parseCallback(body: unknown): NormalizedCallback {
    const b = body as Record<string, unknown> | null;
    const id = String(b?.replica_id ?? b?.video_id ?? "");
    return {
      kind: id.startsWith("mock-r-") ? "replica" : id.startsWith("mock-v-") ? "video" : "unknown",
      providerId: id || null,
      rawStatus: (b?.status as string) ?? null,
    };
  }
}
