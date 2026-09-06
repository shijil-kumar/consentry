import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { RequestWorkspace, type WorkspaceData } from "@/components/request-workspace";
import { engineHasCredentials } from "@/lib/providers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Request" };
export const dynamic = "force-dynamic";

export default async function BuyerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const { supabase, profile } = await requireProfile("buyer");

  const { data: request } = await supabase
    .from("approval_requests")
    .select("id, status, script, tier_id, listing_id, creator_org_id, policy_report")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) notFound();

  const [{ data: tier }, { data: license }, { data: gens }, { data: ld }] = await Promise.all([
    supabase.from("license_tiers").select("name, price_paise").eq("id", request.tier_id).maybeSingle(),
    supabase.from("licenses").select("id, status, expires_at, tier_name, max_generations, duration_days").eq("request_id", requestId).maybeSingle(),
    supabase.from("generations").select("id, status, error, created_at, watermarked, c2pa_manifest").eq("request_id", requestId).order("created_at", { ascending: false }),
    supabase.from("license_details").select("creator_name").eq("request_id", requestId).maybeSingle(),
  ]);

  const report = request.policy_report as { cited_clauses?: WorkspaceData["cited"] } | null;

  // Which live engines is this creator's likeness trained on? Via a dedicated
  // SECURITY DEFINER RPC (avatars are creator-private under RLS, but the engine
  // LIST is marketing — the marketplace already advertises the formats). Only
  // provider names come back, never replica ids.
  const { data: engineList } = await supabase.rpc("available_engines", {
    p_creator_org_id: request.creator_org_id,
  });
  const engines = (engineList ?? []) as string[];

  // Which of those will actually reach a paid API right now? A lapsed
  // subscription must be visible BEFORE the brand picks the engine, not
  // discovered afterwards when the render turns out to be a replay.
  const { data: modeRows } = await supabaseAdmin()
    .from("platform_settings")
    .select("key, value")
    .in("key", engines.map((e) => `engine_mode_${e}`));
  const replayEngines = engines.filter((e) => {
    const mode = (modeRows ?? []).find((r) => r.key === `engine_mode_${e}`)?.value as string | undefined;
    if (mode === "replay") return true;
    if (mode === "live") return false;
    return !engineHasCredentials(e);   // 'auto'
  });

  const initial: WorkspaceData = {
    requestId: request.id,
    requestStatus: request.status,
    script: request.script,
    cited: report?.cited_clauses ?? [],
    tierName: tier?.name ?? "License",
    amountPaise: tier?.price_paise ?? 0,
    creatorName: ld?.creator_name ?? "Creator",
    license: license ? { id: license.id, status: license.status, expires_at: license.expires_at, tier_name: license.tier_name, max_generations: license.max_generations, duration_days: license.duration_days } : null,
    generations: gens ?? [],
    engines,
    replayEngines,
  };

  return (
    <AppShell role="buyer" displayName={profile.display_name}>
      <div className="mx-auto max-w-2xl">
        <Link href="/buyer" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Workspace
        </Link>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your request</h1>
        <RequestWorkspace initial={initial} />
      </div>
    </AppShell>
  );
}
