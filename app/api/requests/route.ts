import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { runPolicyEngine } from "@/lib/policy/engine";
import type { ClauseRow } from "@/lib/policy/deterministic";

export const maxDuration = 60;

// Screen 9 backend — THE approval gate's front door.
// The request row is inserted with the CALLER's JWT (RLS enforces buyer-org,
// published listing, valid tier, server-computed script_hash). The service
// client is used ONLY to record the engine's verdict via apply_policy_verdict()
// — computed entirely from DB truths, no client-controlled authority.
const Body = z.object({
  listing_id: z.string().uuid(),
  tier_id: z.string().uuid(),
  category: z.string().trim().min(2).max(40),
  script: z.string().trim().min(20).max(2000),
  brief_notes: z.string().trim().max(500).optional(),
  language: z.enum(["en","hi","ta","te","ml","bn","kn","mr"]).optional(),
  video_style: z.enum(["talking_head","scene"]).optional(),
  tone: z.enum(["natural","excited","calm","warm","confident"]).optional(),
});

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("org_id, role").eq("id", user.id).single();
  if (!profile || profile.role !== "buyer") {
    return Response.json({ error: "buyers_only" }, { status: 403 });
  }

  // Listing must be published (RLS also enforces this on the insert)
  const { data: listing } = await supabase
    .from("listings").select("id, allowed_categories, status, creator_id")
    .eq("id", body.listing_id).eq("status", "published").maybeSingle();
  if (!listing) return Response.json({ error: "listing_not_available" }, { status: 404 });

  // The tier MUST belong to this listing. Without this a buyer could pair a
  // premium creator's listing_id with a cheap creator's tier_id and inherit
  // that tier's price, quota and duration — checkout prices straight off
  // tier_id. (Prices happen to match across the demo seed, which is exactly
  // why this stayed invisible.)
  const { data: tier } = await supabase
    .from("license_tiers").select("id, listing_id")
    .eq("id", body.tier_id).maybeSingle();
  if (!tier || tier.listing_id !== body.listing_id) {
    return Response.json({ error: "tier_does_not_belong_to_listing" }, { status: 400 });
  }

  // Insert under the caller's own rights; trigger computes script_hash +
  // creator_org_id (the supplied creator_org value is overwritten server-side).
  const { data: request, error: insErr } = await supabase
    .from("approval_requests")
    .insert({
      buyer_org_id: profile.org_id,
      buyer_id: user.id,
      creator_org_id: profile.org_id, // placeholder — trigger overwrites from the listing
      listing_id: body.listing_id,
      tier_id: body.tier_id,
      category: body.category.toLowerCase(),
      script: body.script,
      brief_notes: body.brief_notes ?? null,
    })
    .select("id")
    .single();
  if (insErr) return Response.json({ error: insErr.message }, { status: 400 });

  // Clause set: ALL platform clauses + the creator's enabled clauses
  const admin = supabaseAdmin();
  const [{ data: platform }, { data: enabled }] = await Promise.all([
    admin.from("policy_clauses")
      .select("id, code, title, description, keywords, is_platform")
      .eq("is_platform", true).returns<ClauseRow[]>(),
    admin.from("listing_prohibited_uses")
      .select("custom_note, policy_clauses(id, code, title, description, keywords, is_platform)")
      .eq("listing_id", body.listing_id),
  ]);
  const creatorClauses: ClauseRow[] = (enabled ?? [])
    .map((r) => r.policy_clauses as unknown as ClauseRow)
    .filter(Boolean);

  // Celebrity freeform no-go list (politics/alcohol/competitors/...) joins the
  // clause set as NG-01 so the AI gate enforces it and citations name it.
  const { data: creatorProfile } = await admin
    .from("profiles").select("no_go_list").eq("id", listing.creator_id).maybeSingle();
  if (creatorProfile?.no_go_list?.trim()) {
    creatorClauses.push({
      id: "no-go", code: "NG-01", title: "Celebrity no-go list",
      description: `This celebrity never endorses or mentions: ${creatorProfile.no_go_list.trim()}`,
      keywords: [], is_platform: false,
    });
  }

  // Dev/test-only LLM override header — lets the test suite force the
  // deterministic mock so it never depends on the paid API. Honored ONLY in a
  // non-production build with DEV_OPEN=1 (belt-and-suspenders: a leaked DEV_OPEN
  // in prod can't let a buyer force a policy verdict).
  const devOverride = process.env.DEV_OPEN === "1" && process.env.NODE_ENV !== "production";
  const llmOverride = devOverride ? req.headers.get("x-test-policy-llm") : null;

  const report = await runPolicyEngine({
    script: body.script,
    category: body.category,
    allowedCategories: listing.allowed_categories,
    clauses: [...(platform ?? []), ...creatorClauses],
    llmOverride,
  });

  // Store generation preferences (language + style) — non-authoritative side
  // data the worker passes to the video engine.
  if (body.language || body.video_style || body.tone) {
    await admin.from("request_preferences").insert({
      request_id: request!.id,
      language: body.language ?? "en",
      video_style: body.video_style ?? "talking_head",
      tone: body.tone ?? "natural",
    });
  }

  const { error: verdictErr } = await admin.rpc("apply_policy_verdict", {
    p_request_id: request!.id,
    p_report: report,
  });
  if (verdictErr) {
    return Response.json({ error: `verdict_failed: ${verdictErr.message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    request_id: request!.id,
    outcome: report.outcome,
    cited_clauses: report.cited_clauses,
    llm_mode: report.llm.mode,
    latency_ms: report.latency_ms,
  });
}
