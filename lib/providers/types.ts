// Video-generation provider abstraction (ARCHITECTURE §5.1).
// Mock is the dev/test default (COST CONTROL: no paid render is ever needed to
// build or test UI); Tavus is the primary live engine; D-ID is a fully-wired
// fallback adapter (real /talks API, live-testing pending a paid key); HeyGen
// is built but ToS-gated (service-bureau ban — founder demo clips only).

export type ReplicaState = "training" | "ready" | "error";
export type VideoState = "queued" | "generating" | "ready" | "error";

export interface CreateReplicaInput {
  trainVideoUrl: string; // presigned URL to the consent/training recording
  name: string;
  callbackUrl: string;
}

export interface GenerateVideoInput {
  providerReplicaId: string;
  script: string;
  videoName: string;
  callbackUrl: string;
  fast?: boolean;
  // Generation preferences (request_preferences): providers that support them
  // apply them; others ignore. 'scene' style routes to a creative image-to-
  // video engine (Veo/Kling class via fal.ai) once SCENE_ENGINE_KEY is set.
  language?: string;
  videoStyle?: "talking_head" | "scene";
  tone?: string; // delivery emotion: natural|excited|calm|warm|confident
}

export interface ReplicaStatus {
  state: ReplicaState;
  previewVideoUrl?: string | null;
  error?: string | null;
}

export interface VideoStatus {
  state: VideoState;
  downloadUrl?: string | null;
  hostedUrl?: string | null;
  error?: string | null;
}

// Callbacks are untrusted hints (Tavus sends them unsigned) — parseCallback
// only normalizes; truth ALWAYS comes from a getReplica/getVideo re-fetch.
export interface NormalizedCallback {
  kind: "replica" | "video" | "unknown";
  providerId: string | null;
  rawStatus: string | null;
}

export type ProviderName = "tavus" | "mock" | "did" | "heygen";

export interface VideoGenProvider {
  readonly name: ProviderName;
  createReplica(input: CreateReplicaInput): Promise<{ providerReplicaId: string }>;
  generateVideo(input: GenerateVideoInput): Promise<{ providerVideoId: string }>;
  getReplica(providerReplicaId: string): Promise<ReplicaStatus>;
  getVideo(providerVideoId: string): Promise<VideoStatus>;
  parseCallback(body: unknown): NormalizedCallback;
}
