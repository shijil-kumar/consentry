import type {
  CreateReplicaInput, GenerateVideoInput, NormalizedCallback,
  ReplicaStatus, VideoGenProvider, VideoStatus,
} from "./types";

// ⚠️⚠️ HeyGen adapter — BUILT BUT ToS-GATED. ⚠️⚠️
// HeyGen's Master SaaS Agreement bans using the service for "timesharing or
// service bureau purposes or otherwise for the benefit of a third party"
// (https://www.heygen.com/master-saas-agreement). That is exactly what a
// marketplace does: OUR brand buyers generating videos of OUR creators through
// our HeyGen access. Per the plan, HeyGen is for FOUNDER-produced demo clips
// only, NOT the user-facing engine.
//
// So this adapter refuses to run unless HEYGEN_ALLOW_ENDUSER_GEN=1 is set —
// a deliberate, logged acknowledgement that you accept the ToS risk. It exists
// so HeyGen can be wired/tested one-by-one at go-live if the legal position
// changes (e.g. an enterprise agreement that permits it).
//
// API shapes verified 2026-07-10 (docs.heygen.com):
//   upload   POST https://upload.heygen.com/v1/asset (raw bytes, x-api-key)
//   group    POST /v2/photo_avatar/avatar_group/create { image_key }
//   train    POST /v2/photo_avatar/train { group_id }
//   status   GET  /v2/photo_avatar/train/status/{group_id} → pending|training|ready|failed
//   generate POST /v2/video/generate { video_inputs:[{character, voice}], callback_id } → video_id
//   poll     GET  /v1/video_status.get?video_id= → pending|processing|completed|failed, video_url
const API = "https://api.heygen.com";
const UPLOAD = "https://upload.heygen.com";

function guard() {
  if (process.env.HEYGEN_ALLOW_ENDUSER_GEN !== "1") {
    throw new Error(
      "heygen: end-user generation is ToS-restricted (service-bureau ban). " +
      "Set HEYGEN_ALLOW_ENDUSER_GEN=1 only if your HeyGen agreement permits it.",
    );
  }
}

async function hg<T>(op: string, url: string, init?: RequestInit): Promise<T> {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY missing");
  const res = await fetch(url, {
    ...init,
    headers: { "x-api-key": key, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`heygen:${op} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export class HeyGenProvider implements VideoGenProvider {
  readonly name = "heygen" as const;

  // "Replica" = a trained photo-avatar group. Fetches the training video,
  // uploads it, creates + trains a group, returns the group_id.
  async createReplica(input: CreateReplicaInput) {
    guard();
    const src = await fetch(input.trainVideoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!src.ok) throw new Error(`heygen:createReplica fetch source ${src.status}`);
    const bytes = Buffer.from(await src.arrayBuffer());
    const key = process.env.HEYGEN_API_KEY!;
    const up = await fetch(`${UPLOAD}/v1/asset`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": src.headers.get("content-type") ?? "video/mp4" },
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!up.ok) throw new Error(`heygen:upload ${up.status}`);
    const asset = (await up.json()) as { data?: { image_key?: string } };
    const imageKey = asset.data?.image_key;
    if (!imageKey) throw new Error("heygen:upload no image_key (video sources may need a frame extract)");

    const group = await hg<{ data?: { id?: string } }>("group", `${API}/v2/photo_avatar/avatar_group/create`, {
      method: "POST", body: JSON.stringify({ name: input.name, image_key: imageKey }),
    });
    const groupId = group.data?.id;
    if (!groupId) throw new Error("heygen:group no id");
    await hg("train", `${API}/v2/photo_avatar/train`, { method: "POST", body: JSON.stringify({ group_id: groupId }) });
    return { providerReplicaId: groupId };
  }

  async generateVideo(input: GenerateVideoInput) {
    guard();
    const d = await hg<{ data?: { video_id?: string } }>("generate", `${API}/v2/video/generate`, {
      method: "POST",
      body: JSON.stringify({
        video_inputs: [{
          character: { type: "avatar", avatar_id: input.providerReplicaId, avatar_style: "normal" },
          voice: { type: "text", input_text: input.script, voice_id: process.env.HEYGEN_VOICE_ID ?? "" },
        }],
        // Portrait by default: the trained likeness footage is vertical, so a
        // 16:9 render pillarboxes it with white bars (verified 2026-07-26).
        // Vertical is also what Reels/Shorts ads want. Override per-deployment.
        dimension: {
          width: Number(process.env.HEYGEN_WIDTH ?? 720),
          height: Number(process.env.HEYGEN_HEIGHT ?? 1280),
        },
        callback_id: input.videoName, // echoed on the global webhook
        title: input.videoName,
      }),
    });
    const id = d.data?.video_id;
    if (!id) throw new Error("heygen:generate no video_id");
    return { providerVideoId: id };
  }

  // HeyGen has TWO kinds of likeness behind one id space, and they answer on
  // different endpoints:
  //   • a photo avatar (uploaded still, trained)  -> /v2/photo_avatar/train/status
  //   • a full video avatar (recorded, HeyGen-side) -> /v2/avatar/{id}/details
  // We used to ask the photo-avatar endpoint unconditionally. For the video
  // avatar actually wired into this app that returns {"status":"empty"}, which
  // this function then read as "still training" — forever. It only ever looked
  // fine because the DB row was already marked ready.
  //
  // That endpoint is also dated: HeyGen returns a deprecation warning saying the
  // v2 photo_avatar train-status route is removed on 2026-10-31. So: ask the
  // avatar-details endpoint FIRST (it covers video avatars and is not on the
  // removal list), and only fall back to the training route for a genuine photo
  // avatar that has not finished training yet.
  async getReplica(providerReplicaId: string): Promise<ReplicaStatus> {
    const id = encodeURIComponent(providerReplicaId);

    // A live video avatar resolves here and is, by definition, ready to render.
    try {
      const det = await hg<{ data?: { id?: string; preview_video_url?: string } }>(
        "getReplica.details", `${API}/v2/avatar/${id}/details`);
      if (det.data?.id) {
        return { state: "ready", previewVideoUrl: det.data.preview_video_url ?? null };
      }
    } catch {
      // Not a video avatar (or the lookup failed) — fall through to training.
    }

    const d = await hg<{ data?: { status?: string } }>("getReplica.train",
      `${API}/v2/photo_avatar/train/status/${id}`);
    const s = (d.data?.status ?? "").toLowerCase();
    if (s === "ready" || s === "completed") return { state: "ready", previewVideoUrl: null };
    if (s === "failed" || s === "error") return { state: "error", error: "training failed" };
    // "empty" means this id is not a photo avatar at all. Saying "training"
    // there is what produced the silent forever-pending bug, so name it.
    if (s === "empty") return { state: "error", error: "unknown heygen avatar id" };
    return { state: "training" };
  }

  async getVideo(providerVideoId: string): Promise<VideoStatus> {
    const d = await hg<{ data?: { status?: string; video_url?: string; error?: unknown } }>("getVideo",
      `${API}/v1/video_status.get?video_id=${encodeURIComponent(providerVideoId)}`);
    const s = (d.data?.status ?? "").toLowerCase();
    if (s === "completed") return { state: "ready", downloadUrl: d.data?.video_url ?? null, hostedUrl: d.data?.video_url ?? null };
    if (s === "failed") return { state: "error", error: JSON.stringify(d.data?.error ?? "failed").slice(0, 200) };
    return { state: s === "pending" || s === "waiting" ? "queued" : "generating" };
  }

  parseCallback(body: unknown): NormalizedCallback {
    const b = body as Record<string, unknown> | null;
    const id = (b?.callback_id as string) ?? ((b?.event_data as Record<string, unknown>)?.video_id as string) ?? null;
    return { kind: id ? "video" : "unknown", providerId: id, rawStatus: (b?.event_type as string) ?? null };
  }
}
