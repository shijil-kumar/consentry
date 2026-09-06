import { z } from "zod";
import { after } from "next/server";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 30;

// Phase 6 — the buyer presses Generate. This calls create_generation() (THE
// GATE) with the caller's own JWT: all checks run inside Postgres. Every
// GATE:* error maps to a friendly message. There is NO other insert path.
//
// `engine` is the brand's optional explicit pick (Tavus studio 16:9 vs HeyGen
// social 9:16). The gate validates it against the creator's actually-trained,
// consent-verified avatars in the same transaction as its other checks — an
// impossible pick raises GATE:engine_unavailable before any quota is spent.
// The pick also overrides demo-safe-mode in the worker: choosing a live
// engine is choosing to spend.
const Body = z.object({
  license_id: z.string().uuid(),
  engine: z.enum(["tavus", "heygen"]).optional(),
  // "instant" replays that engine's own most recent real render — free, and
  // fast enough to show Tavus and HeyGen side by side in a demo. "live" calls
  // the paid API. Omitted = whatever the platform is set to.
  mode: z.enum(["live", "instant"]).optional(),
});

const GATE_MESSAGES: Record<string, string> = {
  "GATE:license_not_found": "That license could not be found.",
  "GATE:not_buyer": "Only the brand that owns this license can generate.",
  "GATE:license_not_active": "This license isn't active — complete payment first.",
  "GATE:not_approved": "This script hasn't been approved.",
  "GATE:script_tampered": "The approved script was altered — please submit a new request.",
  "GATE:consent_revoked": "The creator has revoked consent. No new videos can be generated.",
  "GATE:avatar_unavailable": "The creator's replica is unavailable right now.",
  "GATE:quota_exhausted": "You've used every video included in this license.",
  "GATE:engine_unavailable": "This creator's likeness isn't trained on that engine yet.",
  "GATE:instant_needs_engine": "Pick which engine you want an instant preview of.",
};

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { data: generationId, error } = await supabase.rpc("create_generation", {
    p_license_id: body.license_id,
    p_engine: body.engine ?? null,
    p_mode: body.mode ?? null,
  });
  if (error) {
    const code = Object.keys(GATE_MESSAGES).find((c) => error.message.includes(c));
    return Response.json(
      { error: code ?? error.message, message: code ? GATE_MESSAGES[code] : error.message },
      { status: code === "GATE:not_buyer" ? 403
        : code === "GATE:engine_unavailable" || code === "GATE:instant_needs_engine" ? 400 : 409 },
    );
  }

  // Kick the worker so the render starts now, not at the next cron tick.
  // after(), not a bare fetch: serverless tears the function down with the
  // response, and a fire-and-forget fetch silently never runs (verified on
  // production — same failure the approval route had).
  const origin = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  after(async () => {
    await fetch(`${origin}/api/jobs/generation-worker`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    }).catch(() => {});
  });

  return Response.json({ ok: true, generation_id: generationId });
}
