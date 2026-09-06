import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCallbackToken } from "@/lib/webhooks";
import { providerFor } from "@/lib/providers";

export const maxDuration = 60;

// Tavus callback receiver. Callbacks are UNSIGNED (verified 2026-07-04), so:
//   1. the per-job HMAC token in the URL must resolve to a known entity
//   2. the payload is stored but NEVER trusted — state is re-fetched from the
//      provider API before any DB mutation (ARCHITECTURE §5.4)
//   3. dedupe key includes the CONFIRMED status so later lifecycle events for
//      the same entity are not dropped as replays (DATA_MODEL §3.13)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const admin = supabaseAdmin();
  const payload = await req.json().catch(() => ({}));

  const resolved = verifyCallbackToken(token);
  if (!resolved) {
    await admin.from("webhook_events").insert({
      provider: "tavus",
      external_id: `invalid:${token.slice(0, 40)}:${Date.now()}`,
      event_type: "invalid_token",
      payload,
      signature_valid: false,
    });
    return Response.json({ error: "unknown_callback" }, { status: 404 });
  }

  if (resolved.jobType === "replica") {
    const { data: avatar } = await admin.from("avatars")
      .select("id, provider, provider_replica_id, status, consent_record_id")
      .eq("id", resolved.entityId).single();
    if (!avatar || !avatar.provider_replica_id) {
      await admin.from("webhook_events").insert({
        provider: "tavus",
        external_id: `replica:${resolved.entityId}:unresolvable:${Date.now()}`,
        event_type: "replica_callback_unresolvable",
        payload,
        signature_valid: false,
      });
      return Response.json({ ok: true }); // ack fast; reconciliation poller covers us
    }

    // Re-fetch = the only trusted source
    let confirmed: { state: string; previewVideoUrl?: string | null; error?: string | null };
    try {
      confirmed = await providerFor(avatar.provider).getReplica(avatar.provider_replica_id);
    } catch (e) {
      await admin.from("webhook_events").insert({
        provider: "tavus",
        external_id: `replica:${avatar.id}:refetch_failed:${Date.now()}`,
        event_type: "replica_refetch_failed",
        payload: { callback: payload, error: (e as Error).message.slice(0, 200) },
        signature_valid: false,
      });
      return Response.json({ ok: true });
    }

    // Dedupe on token+entity+confirmed status
    const { error: dupErr } = await admin.from("webhook_events").insert({
      provider: "tavus",
      external_id: `replica:${avatar.id}:${confirmed.state}`,
      event_type: `replica_${confirmed.state}`,
      payload,
      signature_valid: true,
      processed_at: new Date().toISOString(),
    });
    if (dupErr) return Response.json({ ok: true, duplicate: true }); // unique violation = replay

    if (confirmed.state === "ready") {
      if (confirmed.previewVideoUrl) {
        await admin.from("avatars")
          .update({ preview_video_url: confirmed.previewVideoUrl }).eq("id", avatar.id);
      }
      await admin.rpc("mark_avatar_ready", {
        p_avatar_id: avatar.id, p_provider_replica_id: avatar.provider_replica_id,
      });
      await admin.rpc("mark_consent_verified", { p_consent_id: avatar.consent_record_id });
    } else if (confirmed.state === "error") {
      await admin.rpc("mark_avatar_failed", {
        p_avatar_id: avatar.id, p_error: confirmed.error ?? "training failed",
      });
    }
    return Response.json({ ok: true, confirmed: confirmed.state });
  }

  // jobType === "video": generation callbacks land in Phase 6 — store + ack.
  await admin.from("webhook_events").insert({
    provider: "tavus",
    external_id: `video:${resolved.entityId}:received:${Date.now()}`,
    event_type: "video_callback_pre_phase6",
    payload,
    signature_valid: true,
  });
  return Response.json({ ok: true });
}
