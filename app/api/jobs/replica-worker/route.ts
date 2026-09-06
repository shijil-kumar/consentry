import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { activeProvider, providerFor } from "@/lib/providers";
import { callbackUrl } from "@/lib/webhooks";
import { isCronRequest } from "@/lib/cron";

export const maxDuration = 120;

// Replica worker — the sanctioned server path for provider work (ARCH §5.4).
// Two callers:
//   · Vercel cron / internal kick with x-cron-secret → processes ALL orgs
//   · a signed-in user (JWT) → processes ONLY their org's rows (UI "kick")
// The service client takes no client-controlled authority: it re-reads the DB
// and only stamps provider ids / calls the mark_* RPCs, which re-validate.
interface AvatarRow {
  id: string;
  org_id: string;
  provider: string;
  provider_replica_id: string | null;
  status: string;
  consent_record_id: string;
}

export async function POST(req: Request) {
  let orgScope: string | null = null;
  const isCron = isCronRequest(req);
  if (!isCron) {
    const supabase = await supabaseForRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const { data: profile } = await supabase
      .from("profiles").select("org_id").eq("id", user.id).single();
    if (!profile) return Response.json({ error: "no_profile" }, { status: 403 });
    orgScope = profile.org_id;
  }

  const admin = supabaseAdmin();
  const summary = { submitted: 0, reconciled: 0, ready: 0, failed: 0, errors: [] as string[] };

  // 1) SUBMIT: training rows not yet sent to a provider
  let q = admin.from("avatars")
    .select("id, org_id, provider, provider_replica_id, status, consent_record_id")
    .eq("status", "training").is("provider_replica_id", null).limit(10);
  if (orgScope) q = q.eq("org_id", orgScope);
  const { data: pending } = await q.returns<AvatarRow[]>();

  for (const avatar of pending ?? []) {
    try {
      const { data: consent } = await admin.from("consent_records")
        .select("consent_video_path, status").eq("id", avatar.consent_record_id).single();
      if (!consent || consent.status === "revoked") {
        await admin.rpc("mark_avatar_failed", { p_avatar_id: avatar.id, p_error: "consent_unavailable" });
        summary.failed++;
        continue;
      }
      const { data: signed, error: signErr } = await admin.storage
        .from("consent-videos").createSignedUrl(consent.consent_video_path, 3600);
      if (signErr || !signed) throw new Error(`sign_url: ${signErr?.message}`);

      const provider = activeProvider(); // env decides the engine for NEW work
      const { providerReplicaId } = await provider.createReplica({
        trainVideoUrl: signed.signedUrl,
        name: `replica-${avatar.id.slice(0, 8)}`,
        callbackUrl: callbackUrl("replica", avatar.id),
      });
      // Sanctioned non-status stamp (same precedent as razorpay_order_id):
      await admin.from("avatars")
        .update({ provider: provider.name, provider_replica_id: providerReplicaId })
        .eq("id", avatar.id).eq("status", "training");
      summary.submitted++;
    } catch (e) {
      summary.errors.push(`submit ${avatar.id}: ${(e as Error).message.slice(0, 200)}`);
      await admin.rpc("mark_avatar_failed", {
        p_avatar_id: avatar.id,
        p_error: (e as Error).message.slice(0, 300),
      });
      summary.failed++;
    }
  }

  // 2) RECONCILE: in-flight rows — poll the provider (webhooks accelerate,
  // polling guarantees; Tavus retries are undocumented)
  let r = admin.from("avatars")
    .select("id, org_id, provider, provider_replica_id, status, consent_record_id")
    .eq("status", "training").not("provider_replica_id", "is", null).limit(25);
  if (orgScope) r = r.eq("org_id", orgScope);
  const { data: inflight } = await r.returns<AvatarRow[]>();

  for (const avatar of inflight ?? []) {
    try {
      const status = await providerFor(avatar.provider).getReplica(avatar.provider_replica_id!);
      summary.reconciled++;
      if (status.state === "ready") {
        if (status.previewVideoUrl) {
          await admin.from("avatars")
            .update({ preview_video_url: status.previewVideoUrl }).eq("id", avatar.id);
        }
        await admin.rpc("mark_avatar_ready", {
          p_avatar_id: avatar.id, p_provider_replica_id: avatar.provider_replica_id,
        });
        // Successful training = the provider accepted the consent footage →
        // the consent record flips to VERIFIED (ARCHITECTURE §9-A; idempotent).
        await admin.rpc("mark_consent_verified", { p_consent_id: avatar.consent_record_id });
        summary.ready++;
      } else if (status.state === "error") {
        await admin.rpc("mark_avatar_failed", {
          p_avatar_id: avatar.id, p_error: status.error ?? "training failed",
        });
        summary.failed++;
      }
    } catch (e) {
      summary.errors.push(`reconcile ${avatar.id}: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  return Response.json({ ok: true, scope: orgScope ?? "all", ...summary });
}

// Vercel Cron issues a GET, not a POST — with only POST exported both crons
// returned 405 and NOTHING ever reconciled in production (replica polling, the
// 72h review reminders, request/licence expiry sweeps). Auth is unchanged:
// isCronRequest() still gates it on the shared secret.
export const GET = POST;
