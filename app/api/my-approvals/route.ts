import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";

export const maxDuration = 15;

// Celebrity's pending preview approvals + their magic-link tokens. Tokens are
// service-only in the DB; this route hands them ONLY to the creator-org owner
// after an RLS-checked read proves the generations belong to them.
export async function GET(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  // SECURITY: RLS alone is NOT enough here. gen_select_parties intentionally
  // lets BOTH parties read a generation, so the BUYER could read its own
  // pending row — and this route then handed back the celebrity's magic-link
  // token, letting a brand approve its own video. Scope to the creator side
  // explicitly: role must be creator AND the generation's creator_org must be
  // theirs. (Nothing else may ever receive an approval token.)
  const { data: profile } = await supabase
    .from("profiles").select("role, org_id").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "creator") {
    return Response.json({ error: "creators_only" }, { status: 403 });
  }

  const { data: gens } = await supabase
    .from("generations")
    .select("id, status, script, version, review_deadline, buyer_org_id, created_at")
    .eq("status", "celebrity_review")
    .eq("creator_org_id", profile.org_id)
    .order("created_at", { ascending: false }).limit(10);
  if (!gens?.length) return Response.json({ ok: true, approvals: [] });

  const admin = supabaseAdmin();
  const ids = gens.map((g) => g.id);
  const [{ data: tokens }, { data: orgs }] = await Promise.all([
    admin.from("approval_tokens")
      .select("token, generation_id, expires_at, used_at").in("generation_id", ids),
    admin.from("orgs").select("id, name").in("id", gens.map((g) => g.buyer_org_id)),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const tokenByGen = new Map(
    (tokens ?? []).filter((t) => !t.used_at && new Date(t.expires_at).getTime() > Date.now())
      .map((t) => [t.generation_id, t.token]),
  );

  return Response.json({
    ok: true,
    approvals: gens.map((g) => ({
      generation_id: g.id,
      brand: orgName.get(g.buyer_org_id) ?? "A brand",
      script_excerpt: g.script.slice(0, 140),
      version: g.version,
      review_deadline: g.review_deadline,
      token: tokenByGen.get(g.id) ?? null,
    })),
  });
}
