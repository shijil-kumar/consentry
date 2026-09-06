import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { ApprovalQueue, type ClauseLite, type ReviewRequest } from "@/components/approval-queue";
import { PendingApprovals } from "@/components/pending-approvals";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

interface RequestRow {
  id: string;
  category: string;
  script: string;
  created_at: string;
  buyer_org_id: string;
  listing_id: string;
  policy_report: {
    llm?: { reasoning?: string };
    cited_clauses?: Array<{ code: string; title: string; evidence_excerpt?: string }>;
  } | null;
}

export default async function CreatorRequestsPage() {
  const { supabase, profile } = await requireProfile("creator");

  const [{ data: requests }, { data: clauseRows }, { data: orgs }, { data: listings }] =
    await Promise.all([
      supabase.from("approval_requests")
        .select("id, category, script, created_at, buyer_org_id, listing_id, policy_report")
        .eq("creator_org_id", profile.org_id)
        .eq("status", "needs_review")
        .order("created_at", { ascending: false })
        .returns<RequestRow[]>(),
      supabase.from("policy_clauses")
        .select("code, title").eq("is_platform", false).order("sort_order").returns<ClauseLite[]>(),
      supabase.from("orgs").select("id, name"),
      supabase.from("listings").select("id, title"),
    ]);

  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const listingTitle = new Map((listings ?? []).map((l) => [l.id, l.title]));

  const items: ReviewRequest[] = (requests ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    script: r.script,
    created_at: r.created_at,
    buyer_org_name: orgName.get(r.buyer_org_id) ?? "A brand",
    listing_title: listingTitle.get(r.listing_id) ?? "your listing",
    llm_reasoning: r.policy_report?.llm?.reasoning ?? null,
    cited: r.policy_report?.cited_clauses ?? [],
  }));

  return (
    <AppShell role="creator" displayName={profile.display_name}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Everything that needs your yes — finished videos first, then the rare script the AI gate wants a human decision on.
          </p>
        </div>

        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Videos waiting for your approval
          </h2>
          <PendingApprovals />
        </div>

        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Scripts needing your call
        </h2>
        {items.length === 0 && (requests === null) ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
        ) : (
          <ApprovalQueue requests={items} clauses={clauseRows ?? []} />
        )}
      </div>
    </AppShell>
  );
}
