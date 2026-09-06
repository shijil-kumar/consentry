import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  VideoGenProvider, ProviderName, ReplicaStatus, VideoStatus, NormalizedCallback,
} from "./types";

// Replay: stands in for a paid engine whose subscription is not available.
//
// It is NOT a mock. The mock invents a generic sample to prove the plumbing.
// Replay returns the real output that THIS engine produced for this platform
// earlier, so the demo shows what Tavus or HeyGen actually looks like — the
// framing, the lip-sync, the aspect ratio — rather than a placeholder.
//
// Everything downstream stays real: the file is fetched, the visible AI label
// is burned into the frames, Content Credentials are signed into it, it is
// hashed, it waits on the celebrity's approval, and it can be verified at
// /inspect afterwards. The single substituted step is the provider API call.
//
// The timings below are deliberate. A render that completes instantly reads as
// fake to anyone watching, and it would also skip the "generating" state the
// brand workspace is built to show.
const REPLICA_MS = 4_000;
const VIDEO_MS = 8_000;
// Instant mode skips the simulated wait entirely. It exists so a brand can see
// "this is what HeyGen looks like" beside "this is what Tavus looks like"
// without paying for two renders or narrating over four minutes of spinner.
// The real media pipeline (watermark burn-in + C2PA signing) still runs, so
// the floor is genuine work, not theatre.
const INSTANT_MS = 0;

/** Encodes the creation time in the id so status is stateless, as with mock. */
function ageMs(id: string): number | null {
  const m = id.match(/^replay-[rv]-(\d+)-/);
  return m ? Date.now() - Number(m[1]) : null;
}

export class ReplayProvider implements VideoGenProvider {
  /** The engine being stood in for — records stay attributed to it. */
  readonly name: ProviderName;
  private readonly videoMs: number;

  constructor(engine: "tavus" | "heygen", opts?: { instant?: boolean }) {
    this.name = engine;
    this.videoMs = opts?.instant ? INSTANT_MS : VIDEO_MS;
  }

  async createReplica(): Promise<{ providerReplicaId: string }> {
    return { providerReplicaId: `replay-r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async generateVideo(): Promise<{ providerVideoId: string }> {
    return { providerVideoId: `replay-v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async getReplica(providerReplicaId: string): Promise<ReplicaStatus> {
    const age = ageMs(providerReplicaId);
    if (age === null) return { state: "error" as const, error: "replay: unknown replica id" };
    return age < REPLICA_MS
      ? { state: "training" as const }
      : { state: "ready" as const };
  }

  async getVideo(providerVideoId: string): Promise<VideoStatus> {
    const age = ageMs(providerVideoId);
    if (age === null) return { state: "error" as const, error: "replay: unknown video id" };
    if (age < this.videoMs) return { state: "generating" as const };
    // The worker recognises this scheme and reads the master from assets/.
    return {
      state: "ready" as const,
      downloadUrl: `replay://${this.name}/${providerVideoId}.mp4`,
      hostedUrl: null,
    };
  }

  parseCallback(body: unknown): NormalizedCallback {
    // Replay never calls back — the worker polls getVideo. Normalise anyway so
    // a stray webhook cannot crash the route.
    const id = typeof body === "object" && body !== null && "id" in body
      ? String((body as { id: unknown }).id) : null;
    return {
      kind: id?.startsWith("replay-r-") ? "replica" : id?.startsWith("replay-v-") ? "video" : "unknown",
      providerId: id,
      rawStatus: null,
    };
  }
}

/** Bytes of the stand-in master for an engine. Throws if it was not shipped. */
export async function readReplayMaster(engine: string): Promise<Buffer> {
  const safe = engine === "tavus" || engine === "heygen" ? engine : null;
  if (!safe) throw new Error(`replay: no master for engine "${engine}"`);
  return readFile(path.join(process.cwd(), "assets", `replay-${safe}.mp4`));
}
