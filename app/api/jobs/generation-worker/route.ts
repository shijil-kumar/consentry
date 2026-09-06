import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { providerFor, resolveEngine, type EngineMode } from "@/lib/providers";
import { ReplayProvider, readReplayMaster } from "@/lib/providers/replay";
import { callbackUrl } from "@/lib/webhooks";
import { processDeliverable, makePreview, type ManifestInput } from "@/lib/media/pipeline";
import { randomBytes } from "node:crypto";
import { isCronRequest } from "@/lib/cron";

export const maxDuration = 300; // media pipeline (ffmpeg + c2patool) on short clips

// Generation worker — sanctioned server path (DATA_MODEL §5 carve-out for the
// atomic claim). Dual auth like the replica worker. Does everything:
//   SUBMIT   queued → generating (atomic claim) → provider.generateVideo
//   FINISH   generating → (provider ready) → processing → media pipeline →
//            upload to deliverables → complete_generation → delivered
//   SWEEP    expire stale approval_requests + payment_pending licenses
interface GenRow {
  id: string; license_id: string; request_id: string;
  buyer_org_id: string; creator_org_id: string;
  provider: string; provider_video_id: string | null;
  script: string; script_hash: string; status: string;
  requested_engine?: string | null;
  requested_mode?: string | null;
  render_mode?: string | null;
}

// One query chain license → listing → avatar → consent + creator. Kept small
// and explicit; service client, read-only.
async function resolveRig(
  admin: ReturnType<typeof supabaseAdmin>,
  licenseId: string,
) {
  const { data: lic } = await admin.from("licenses")
    .select("expires_at, listing_id").eq("id", licenseId).single();
  const { data: listing } = await admin.from("listings")
    .select("creator_id, avatar_id").eq("id", lic!.listing_id).single();
  const { data: avatar } = await admin.from("avatars")
    .select("provider, provider_replica_id, status, consent_record_id")
    .eq("id", listing!.avatar_id).single();
  const { data: creator } = await admin.from("profiles")
    .select("handle").eq("id", listing!.creator_id).single();
  const { data: consent } = await admin.from("consent_records")
    .select("status, content_hash, verified_at").eq("id", avatar!.consent_record_id).single();
  return {
    licenseExpiresAt: lic?.expires_at ?? null,
    avatarProvider: avatar?.provider ?? "mock",
    providerReplicaId: avatar?.provider_replica_id ?? null,
    avatarStatus: avatar?.status ?? "unknown",
    creatorHandle: creator?.handle ?? null,
    consentStatus: consent?.status ?? "unknown",
    consentHash: consent?.content_hash ?? "",
    consentVerifiedAt: consent?.verified_at ?? null,
  };
}

export async function POST(req: Request) {
  const isCron = isCronRequest(req);
  let orgScope: string | null = null;
  if (!isCron) {
    const supabase = await supabaseForRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
    if (!profile) return Response.json({ error: "no_profile" }, { status: 403 });
    orgScope = profile.org_id;
  }

  const admin = supabaseAdmin();
  const summary: { submitted: number; delivered: number; failed: number; blocked: number; expired_requests: number; expired_licenses: number; previews?: number; errors: string[] } = { submitted: 0, delivered: 0, failed: 0, blocked: 0, expired_requests: 0, expired_licenses: 0, errors: [] };

  // ── SUBMIT: claim queued rows atomically ──
  let q = admin.from("generations")
    .select("id, license_id, request_id, buyer_org_id, creator_org_id, provider, provider_video_id, script, script_hash, status, requested_engine, requested_mode, render_mode")
    .eq("status", "queued").limit(5);
  if (orgScope) q = q.eq("buyer_org_id", orgScope);
  const { data: queued } = await q.returns<GenRow[]>();

  for (const gen of queued ?? []) {
    // atomic compare-and-set claim
    const { data: claimed } = await admin.from("generations")
      .update({ status: "generating" }).eq("id", gen.id).eq("status", "queued")
      .select("id").maybeSingle();
    if (!claimed) continue; // someone else claimed it

    try {
      const rig = await resolveRig(admin, gen.license_id);
      // belt-and-braces consent re-check before spending on a provider call
      if (rig.consentStatus !== "verified") {
        await admin.from("generations").update({ status: "blocked", error: "consent_revoked_preflight" }).eq("id", gen.id);
        summary.blocked++;
        continue;
      }
      if (rig.avatarStatus !== "ready" || !rig.providerReplicaId) {
        await admin.from("generations").update({ status: "failed", error: "avatar_unavailable" }).eq("id", gen.id);
        summary.failed++;
        continue;
      }

      // Engine resolution, in priority order:
      //   1. requested_engine — the brand explicitly picked an engine in the
      //      UI. Resolved to the creator's ready avatar on THAT engine, and it
      //      overrides DEMO_SAFE_MODE: an explicit pick is a deliberate act of
      //      spending, while the staged demo flow never sets it.
      //   2. DEMO_SAFE_MODE=1 — route through the free mock engine so a staged
      //      demo can never stall or spend on stage.
      //   3. the listing's own avatar engine (Tavus for the live creator).
      let engineName = rig.avatarProvider;
      let replicaId = rig.providerReplicaId;
      if (gen.requested_engine && gen.requested_engine !== engineName) {
        // Same creator, same verified consent, different engine. The consent
        // check must run against the avatar that actually renders.
        const { data: alt } = await admin.from("avatars")
          .select("provider, provider_replica_id, status, consent_records!inner(status)")
          .eq("org_id", gen.creator_org_id).eq("provider", gen.requested_engine)
          .eq("status", "ready").eq("consent_records.status", "verified")
          .limit(1).maybeSingle();
        if (!alt?.provider_replica_id) {
          await admin.from("generations").update({ status: "failed", error: `engine_unavailable:${gen.requested_engine}` }).eq("id", gen.id);
          summary.failed++;
          continue;
        }
        engineName = alt.provider;
        replicaId = alt.provider_replica_id;
      }
      const useMock = process.env.DEMO_SAFE_MODE === "1" && !gen.requested_engine;
      // Paid engines can be switched to replay per-engine from the admin
      // console. Replay swaps ONLY the provider call — the avatar and verified
      // consent gates above still had to pass, so it never invents a replica
      // or a consent that does not exist.
      const { data: modeRow } = await admin.from("platform_settings")
        .select("value").eq("key", `engine_mode_${engineName}`).maybeSingle();
      const engineMode = ((modeRow?.value as string) ?? "auto") as EngineMode;
      // The brand can ask for an instant preview of a specific engine. That is
      // a request-level choice, so it beats the platform setting — see
      // resolveEngine. It never beats the consent/avatar gates in
      // create_generation, which already passed to get here.
      const wantsInstant = gen.requested_mode === "instant";
      const resolved = useMock
        ? { provider: providerFor("mock"), renderMode: "live" as const, reason: "demo safe mode" }
        : resolveEngine(engineName, engineMode, { instant: wantsInstant });
      const provider = resolved.provider;
      if (resolved.renderMode === "replay") {
        await admin.from("generations").update({ render_mode: "replay" }).eq("id", gen.id);
      }
      const { data: prefs } = await admin.from("request_preferences")
        .select("language, video_style, tone").eq("request_id", gen.request_id).maybeSingle();
      const { providerVideoId } = await provider.generateVideo({
        providerReplicaId: useMock ? "mock-safe" : replicaId!,
        script: gen.script,
        videoName: `gen-${gen.id.slice(0, 8)}`,
        callbackUrl: callbackUrl("video", gen.id),
        fast: process.env.TAVUS_FAST === "1",
        language: prefs?.language ?? "en",
        videoStyle: prefs?.video_style ?? "talking_head",
        tone: prefs?.tone ?? "natural",
      });
      await admin.from("generations")
        .update({ provider: provider.name, provider_video_id: providerVideoId })
        .eq("id", gen.id);
      summary.submitted++;
    } catch (e) {
      await admin.from("generations").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", gen.id);
      summary.errors.push(`submit ${gen.id}: ${(e as Error).message.slice(0, 150)}`);
      summary.failed++;
    }
  }

  // -- FINISH stage A: render done -> PRIVATE master + watermarked preview ->
  // celebrity_review. The clean master never reaches the brand at this stage.
  let g = admin.from("generations")
    .select("id, license_id, request_id, buyer_org_id, creator_org_id, provider, provider_video_id, script, script_hash, status, render_mode")
    .eq("status", "generating").not("provider_video_id", "is", null).limit(3);
  if (orgScope) g = g.eq("buyer_org_id", orgScope);
  const { data: generating } = await g.returns<GenRow[]>();

  for (const gen of generating ?? []) {
    let status;
    try {
      // Poll whoever actually started this render. A replay id belongs to the
      // ReplayProvider — asking the live engine about it would never return
      // ready, and the generation would sit at "generating" indefinitely.
      const poller = gen.provider_video_id?.startsWith("replay-")
        ? new ReplayProvider(gen.provider === "heygen" ? "heygen" : "tavus",
            { instant: gen.requested_mode === "instant" })
        : providerFor(gen.provider);
      status = await poller.getVideo(gen.provider_video_id!);
    } catch (e) {
      summary.errors.push(`poll ${gen.id}: ${(e as Error).message.slice(0, 120)} (will retry)`);
      continue;
    }
    if (status.state === "error") {
      await admin.from("generations").update({ status: "failed", error: status.error ?? "provider error" }).eq("id", gen.id);
      summary.failed++;
      continue;
    }
    if (status.state !== "ready" || !status.downloadUrl) continue; // still cooking

    try {
      const { data: proc } = await admin.from("generations")
        .update({ status: "processing", raw_output_url: status.downloadUrl })
        .eq("id", gen.id).eq("status", "generating").select("id").maybeSingle();
      if (!proc) continue;

      let rawBytes: Buffer;
      if (status.downloadUrl.startsWith("mock://")) {
        rawBytes = await readFile(path.join(process.cwd(), "assets", "mock-raw.mp4"));
      } else if (status.downloadUrl.startsWith("replay://")) {
        // replay://<engine>/<id>.mp4 — that engine's own earlier output, which
        // then goes through the identical watermark + C2PA + hashing path.
        rawBytes = await readReplayMaster(new URL(status.downloadUrl).hostname);
      } else {
        const res = await fetch(status.downloadUrl, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`download ${res.status}`);
        rawBytes = Buffer.from(await res.arrayBuffer());
      }

      // 1) master -> private storage (masters path is NEVER served to buyers)
      const masterPath = `${gen.buyer_org_id}/${gen.id}/master.mp4`;
      const { error: mErr } = await admin.storage.from("deliverables")
        .upload(masterPath, rawBytes, { contentType: "video/mp4", upsert: true });
      if (mErr) throw new Error(`master upload: ${mErr.message}`);

      // 2) 480p watermarked preview.
      // If the transcode fails we FAIL the generation rather than fall back to
      // rawBytes. That fallback used to exist and it quietly published the clean
      // master as the "preview" — the exact thing the product promises cannot
      // happen ("the clean video stays locked until you approve"). It fired for
      // real on Vercel, where drawtext had no font. A visible failure the brand
      // can retry beats an invisible leak of un-approved footage.
      const previewBytes = await makePreview(rawBytes);
      if (!previewBytes) throw new Error("preview transcode failed; refusing to serve the un-watermarked master");
      const previewPath = `${gen.buyer_org_id}/${gen.id}/preview.mp4`;
      const { error: pErr } = await admin.storage.from("deliverables")
        .upload(previewPath, previewBytes, { contentType: "video/mp4", upsert: true });
      if (pErr) throw new Error(`preview upload: ${pErr.message}`);

      // 3) -> celebrity_review + 72h window + ledger event + magic-link token
      const deadline = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
      await admin.from("generations")
        .update({ status: "celebrity_review", preview_path: previewPath, review_deadline: deadline })
        .eq("id", gen.id);
      await admin.from("approval_events").insert({
        generation_id: gen.id, actor_label: "system", action: "preview_created", script_hash: gen.script_hash,
      });
      const token = randomBytes(24).toString("base64url");
      await admin.from("approval_tokens").insert({ token, generation_id: gen.id, expires_at: deadline });
      await admin.rpc("notify", {
        p_org: gen.creator_org_id, p_type: "request_received",
        p_title: "A video is waiting for your approval",
        p_body: "A brand preview is ready. Watch it, then approve, request changes, or decline.",
        p_link: `/approve/${token}`,
      }).then(() => {}, () => {});
      summary.previews = (summary.previews ?? 0) + 1;
    } catch (e) {
      await admin.from("generations").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", gen.id);
      summary.errors.push(`preview ${gen.id}: ${(e as Error).message.slice(0, 150)}`);
      summary.failed++;
    }
  }

  // -- FINISH stage B: celebrity APPROVED -> label + C2PA-sign the master ->
  // deliver to the brand. Approval only ever comes from the approval_action
  // RPC; there is NO auto-approve path anywhere - silence escalates instead.
  let a = admin.from("generations")
    .select("id, license_id, request_id, buyer_org_id, creator_org_id, provider, provider_video_id, script, script_hash, status, render_mode")
    .eq("status", "approved").limit(3);
  if (orgScope) a = a.eq("buyer_org_id", orgScope);
  const { data: approvedRows } = await a.returns<GenRow[]>();

  for (const gen of approvedRows ?? []) {
    try {
      const { data: proc } = await admin.from("generations")
        .update({ status: "processing" })
        .eq("id", gen.id).eq("status", "approved").select("id").maybeSingle();
      if (!proc) continue;

      const masterPath = `${gen.buyer_org_id}/${gen.id}/master.mp4`;
      const { data: masterBlob, error: dErr } = await admin.storage.from("deliverables").download(masterPath);
      if (dErr || !masterBlob) throw new Error(`master download: ${dErr?.message ?? "missing"}`);
      const rawBytes = Buffer.from(await masterBlob.arrayBuffer());

      const rig = await resolveRig(admin, gen.license_id);
      const { data: buyerOrg } = await admin.from("orgs").select("name").eq("id", gen.buyer_org_id).single();
      const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
      const manifest: ManifestInput = {
        generationId: gen.id, licenseId: gen.license_id, requestId: gen.request_id,
        creatorHandle: rig.creatorHandle,
        buyerOrgName: buyerOrg?.name ?? "brand",
        consentRecordHash: rig.consentHash,
        consentVerifiedAt: rig.consentVerifiedAt,
        scriptSha256: gen.script_hash,
        licenseExpiresAt: rig.licenseExpiresAt,
        verifyUrl: `${base}/verify/${gen.id}`,
        provider: gen.provider,
      };

      const result = await processDeliverable(
        rawBytes,
        { ...manifest, renderMode: gen.render_mode === "replay" ? "replay" : "live" },
      );
      const outPath = `${gen.buyer_org_id}/${gen.id}/final.mp4`;
      const { error: upErr } = await admin.storage.from("deliverables")
        .upload(outPath, result.bytes, { contentType: "video/mp4", upsert: true });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      await admin.rpc("complete_generation", {
        p_generation_id: gen.id,
        p_output_path: outPath,
        p_manifest: { ...result.manifestSummary, notes: result.notes, watermarked: result.watermarked, signed: result.signed },
      });
      summary.delivered++;
    } catch (e) {
      await admin.from("generations").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", gen.id);
      summary.errors.push(`finish ${gen.id}: ${(e as Error).message.slice(0, 150)}`);
      summary.failed++;
    }
  }

  // -- REMINDERS: reviews nearing/past the 72h window get nudges + escalation.
  // Deliberately NO auto-approve: silence never equals consent.
  if (isCron) {
    const { data: pending } = await admin.from("generations")
      .select("id, creator_org_id, review_deadline")
      .eq("status", "celebrity_review").not("review_deadline", "is", null).limit(20);
    for (const gen of pending ?? []) {
      const msLeft = new Date(gen.review_deadline as string).getTime() - Date.now();
      if (msLeft > 48 * 3600 * 1000) continue;
      const { data: prior } = await admin.from("approval_events")
        .select("id").eq("generation_id", gen.id).eq("action", "reminder_sent")
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).limit(1);
      if (prior?.length) continue;
      await admin.from("approval_events").insert({ generation_id: gen.id, actor_label: "system", action: "reminder_sent" });
      await admin.rpc("notify", {
        p_org: gen.creator_org_id, p_type: "request_received",
        p_title: msLeft > 0 ? "Reminder: a video is awaiting your approval" : "Approval window passed - escalated",
        p_body: msLeft > 0 ? "The 72-hour review window is closing." : "We never auto-approve. Your team has been flagged.",
        p_link: "/creator/requests",
      }).then(() => {}, () => {});
    }
  }

  // ── SWEEP: expire stale requests + payment_pending licenses (cron only) ──
  // Uses the guarded RPCs (migration 0003): a request that already has a license
  // is NEVER expired, so a paid long-duration license (e.g. 30-day campaign) is
  // not bricked mid-term by create_generation's request-status re-check.
  if (isCron) {
    const { data: er } = await admin.rpc("sweep_expire_requests");
    summary.expired_requests = (er as number) ?? 0;
    const { data: el } = await admin.rpc("sweep_expire_pending_licenses");
    summary.expired_licenses = (el as number) ?? 0;
  }

  return Response.json({ ok: true, scope: orgScope ?? "all", ...summary });
}

// Vercel Cron issues a GET, not a POST — with only POST exported both crons
// returned 405 and NOTHING ever reconciled in production (replica polling, the
// 72h review reminders, request/licence expiry sweeps). Auth is unchanged:
// isCronRequest() still gates it on the shared secret.
export const GET = POST;
