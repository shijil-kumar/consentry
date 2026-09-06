import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { after } from "next/server";

export const maxDuration = 30;

// Magic-link approval endpoint. The token IS the credential (single-use,
// 72h expiry, unguessable 24-byte value) — the celebrity acts from a phone
// without logging in. Never exposes the clean master; only the watermarked
// preview via a short-lived signed URL.
const hits = new Map<string, { n: number; t: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 20;
}

async function loadToken(token: string) {
  const admin = supabaseAdmin();
  const { data: tok } = await admin.from("approval_tokens")
    .select("token, generation_id, expires_at, used_at").eq("token", token).maybeSingle();
  if (!tok) return { admin, error: "not_found" as const };
  if (tok.used_at) return { admin, error: "already_used" as const };
  if (new Date(tok.expires_at).getTime() < Date.now()) return { admin, error: "expired" as const };
  return { admin, tok };
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const { token } = await ctx.params;
  const { admin, tok, error } = await loadToken(token);
  if (error) return Response.json({ error }, { status: error === "not_found" ? 404 : 410 });

  const { data: gen } = await admin.from("generations")
    .select("id, status, script, script_hash, version, review_deadline, preview_path, buyer_org_id, license_id, request_id")
    .eq("id", tok!.generation_id).single();
  if (!gen) return Response.json({ error: "not_found" }, { status: 404 });

  const [{ data: buyer }, { data: lic }, { data: verdict }] = await Promise.all([
    admin.from("orgs").select("name").eq("id", gen.buyer_org_id).single(),
    admin.from("licenses").select("amount_paise, expires_at").eq("id", gen.license_id).maybeSingle(),
    admin.from("approval_requests").select("policy_report").eq("id", gen.request_id).maybeSingle(),
  ]);

  let previewUrl: string | null = null;
  if (gen.preview_path) {
    const { data: signed } = await admin.storage.from("deliverables")
      .createSignedUrl(gen.preview_path, 3600);
    previewUrl = signed?.signedUrl ?? null;
  }

  const report = verdict?.policy_report as { outcome?: string; cited_clauses?: unknown[] } | null;
  return Response.json({
    ok: true,
    status: gen.status,
    brand: buyer?.name ?? "A brand",
    fee_paise: lic?.amount_paise ?? null,
    script: gen.script,
    version: gen.version,
    review_deadline: gen.review_deadline,
    preview_url: previewUrl,
    ai_check: report ? { outcome: report.outcome, cited: (report.cited_clauses ?? []).length } : null,
  });
}

const Body = z.object({
  action: z.enum(["approve", "changes", "decline"]),
  comment: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const { token } = await ctx.params;

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }

  const { admin, error } = await loadToken(token);
  if (error) return Response.json({ error }, { status: error === "not_found" ? 404 : 410 });

  const { data, error: rpcErr } = await admin.rpc("approval_action", {
    p_token: token, p_action: body.action, p_comment: body.comment ?? null,
  });
  if (rpcErr) {
    return Response.json({ error: rpcErr.message.replace(/^APPROVAL:/, "") }, { status: 400 });
  }

  // Approving must actually START the release, not just record the decision.
  // Sealing runs in the worker, which otherwise only fires on the daily cron or
  // when a brand happens to have their workspace tab open polling — so an
  // approval could sit at 'approved' indefinitely and never reach the brand.
  //
  // Must be after(), not a bare un-awaited fetch: on serverless the function is
  // torn down once the response is returned, so fire-and-forget silently never
  // runs (verified on production — the generation stayed 'approved' for 96s).
  // after() keeps the work alive past the response without delaying it.
  if (body.action === "approve") {
    const origin = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    after(async () => {
      await fetch(`${origin}/api/jobs/generation-worker`, {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      }).catch(() => {});
    });
  }

  return Response.json(data);
}
